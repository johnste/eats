import { addDays, MEALS, scaleMacros, toDateKey, type Meal } from '@eats/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';
import type { Database } from '../db/client.ts';
import { foods, logEntries } from '../db/schema.ts';
import {
  insertCustomFood,
  recordFoodView,
  searchLocal,
  withServings,
} from '../lib/foods.ts';
import { entriesForRange, goalOn, snapshotFor, totalsOf } from '../lib/log.ts';
import { AttemptLimiter } from '../lib/attempts.ts';
import { resolveAccessToken, SCOPE } from '../lib/oauth.ts';
import { resolveToken, type TokenOwner } from '../lib/tokens.ts';

/**
 * A Model Context Protocol server, so an AI assistant can log food for you.
 *
 * Streamable HTTP transport: one endpoint, JSON-RPC over POST. Responses are
 * plain JSON rather than SSE -- the spec allows either, and nothing here
 * streams or pushes, so a session layer would be machinery with no purpose.
 *
 * Deliberately narrow: search, log, and read back today. An agent token
 * cannot read your history, your weights, or your profile, and cannot delete
 * anything. A token pasted into a chat is a token given to that provider, so
 * the worst case is somebody adding junk to today -- visible, and removable.
 */

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = new Set([PROTOCOL_VERSION, '2025-03-26']);

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

type Id = string | number | null;

const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: Id, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

/** A tool outcome. isError reports a failure the model should read and retry. */
interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError: boolean;
}

const text = (body: string, isError = false): ToolResult => ({
  content: [{ type: 'text', text: body }],
  isError,
});

/* ------------------------------------------------------------------ tools --- */

/**
 * The window an agent may touch: today and yesterday.
 *
 * Older days are history. An agent correcting a mistake is working from what
 * it remembers of this conversation, and that memory reaches about as far
 * back as last night -- beyond it, a confident edit is a guess, and a guess
 * that rewrites a week-old day is worse than no edit at all.
 */
export const isEditableDay = (date: string, today = toDateKey()): boolean =>
  date === today || date === addDays(today, -1);

const dayArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional();

export const searchArgs = z.object({
  query: z.string().min(1).max(100),
});

export const logArgs = z.object({
  grams: z.number().positive().max(5000),
  meal: z.enum(MEALS),
  /** Today if omitted; yesterday is the furthest back allowed. */
  date: dayArg,
  foodId: z.uuid().optional(),
  /** For food not in the database: supply a name and per-100g macros. */
  name: z.string().min(1).max(200).optional(),
  brand: z.string().max(120).optional(),
  /** Log a second food under a name that already exists. */
  createNew: z.boolean().optional(),
  kcal100g: z.number().min(0).max(900).optional(),
  protein100g: z.number().min(0).max(100).optional(),
  carbs100g: z.number().min(0).max(100).optional(),
  fat100g: z.number().min(0).max(100).optional(),
});

export const dayArgs = z.object({ date: dayArg });

export const moveArgs = z.object({
  entryId: z.uuid(),
  meal: z.enum(MEALS).optional(),
  date: dayArg,
  grams: z.number().positive().max(5000).optional(),
});

export const deleteArgs = z.object({ entryId: z.uuid() });

export const TOOLS = [
  {
    name: 'search_foods',
    title: 'Search foods',
    description:
      'Find a food already known to the app, by name or brand. Always try ' +
      'this first: logging by name creates a new food, and a second copy of ' +
      'something already there is worse than a search that finds nothing. ' +
      'Covers foods the ' +
      'user created, Swedish staples from Livsmedelsverket, and products cached ' +
      'from Open Food Facts. Returns each match with its id and per-100g macros. ' +
      'Use this before log_food so you can log an existing food by id rather ' +
      'than inventing macros.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Name or brand, e.g. "havregryn"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'log_food',
    title: 'Log food',
    description:
      "Add food to today's log. Either pass foodId from search_foods, or " +
      'describe a food not in the database by giving name plus all four per-100g ' +
      'values (kcal100g, protein100g, carbs100g, fat100g) — a new food is then ' +
      'created and logged. Amount is always in grams. Only give macros you are ' +
      'confident about; ask the user rather than guessing at a packet you cannot see.',
    inputSchema: {
      type: 'object',
      properties: {
        grams: { type: 'number', description: 'Amount eaten, in grams' },
        meal: {
          type: 'string',
          enum: [...MEALS],
          description: 'Which meal this belongs to',
        },
        foodId: {
          type: 'string',
          description: 'id from search_foods. Omit when describing a new food.',
        },
        name: { type: 'string', description: 'Name, when creating a new food' },
        brand: { type: 'string', description: 'Brand, optional' },
        createNew: {
          type: 'boolean',
          description:
            'Only after a refusal: log a second food under a name that ' +
            'already exists, because it genuinely is a different food.',
        },
        kcal100g: { type: 'number', description: 'Calories per 100g' },
        protein100g: { type: 'number', description: 'Protein grams per 100g' },
        carbs100g: {
          type: 'number',
          description: 'Carbohydrate grams per 100g',
        },
        fat100g: { type: 'number', description: 'Fat grams per 100g' },
      },
      required: ['grams', 'meal'],
    },
  },
  {
    name: 'get_day',
    title: 'Read a day of the log',
    description:
      "Read back a day: totals, the day's goal if one is set, and every entry " +
      'grouped by meal, each with the id that move_entry and delete_entry take. ' +
      'Defaults to today; yesterday is the furthest back available.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'YYYY-MM-DD. Today if omitted, and only yesterday otherwise.',
        },
      },
    },
  },
  {
    name: 'move_entry',
    title: 'Move or correct an entry',
    description:
      'Change which meal an entry belongs to, which day it is on, or how many ' +
      'grams it was. Use it to put right something logged to the wrong meal or ' +
      'day. Get the id from get_day. Only today and yesterday can be changed.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'The entry id from get_day' },
        meal: {
          type: 'string',
          enum: [...MEALS],
          description: 'Move it to this meal',
        },
        date: { type: 'string', description: 'Move it to this day (YYYY-MM-DD)' },
        grams: { type: 'number', description: 'Correct the amount' },
      },
      required: ['entryId'],
    },
  },
  {
    name: 'delete_entry',
    title: 'Remove an entry',
    description:
      'Take an entry off the log entirely -- something logged twice, or that ' +
      'was not eaten. Get the id from get_day. Only today and yesterday can be ' +
      'changed. This cannot be undone, so confirm before using it.',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'The entry id from get_day' },
      },
      required: ['entryId'],
    },
  },
] as const;

/* -------------------------------------------------------------- execution --- */

/**
 * Same food, loosely. Case and spacing differ between how a person types a
 * name and how it was stored; nothing else is folded, because "Agg" and "Ägg"
 * being the same word is a guess and merging two foods is not reversible.
 */
export const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\s+/g, ' ') ===
  b.trim().toLowerCase().replace(/\s+/g, ' ');

const describe = (f: {
  name: string;
  brand: string | null;
  id: string;
  kcal100g: number;
}) =>
  `${f.name}${f.brand ? ` (${f.brand})` : ''} — id ${f.id}, ${Math.round(f.kcal100g)} kcal/100g`;

/** Said the same way everywhere, so the limit reads as a rule not a glitch. */
const refuseDay = (date: string): string =>
  `${date} is outside what can be changed from here. Only ${toDateKey()} ` +
  `(today) and ${addDays(toDateKey(), -1)} (yesterday) are editable — older ` +
  'days have to be edited in the app.';

async function callTool(
  db: Database,
  owner: TokenOwner,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  if (name === 'search_foods') {
    const parsed = searchArgs.safeParse(args ?? {});
    if (!parsed.success)
      return text(`Invalid arguments: ${parsed.error.message}`, true);

    const rows = await searchLocal(db, owner.id, parsed.data.query, 10);
    const found = await withServings(db, rows);
    if (found.length === 0) {
      return text(
        `No food matching "${parsed.data.query}". Log it with log_food by ` +
          'giving a name and per-100g macros.',
      );
    }
    return text(
      found
        .map(
          (f) =>
            `${f.name}${f.brand ? ` (${f.brand})` : ''} — id ${f.id} — per 100g: ` +
            `${Math.round(f.kcal100g)} kcal, ${f.protein100g}g protein, ` +
            `${f.carbs100g}g carbs, ${f.fat100g}g fat` +
            (f.servings.length
              ? ` — portions: ${f.servings.map((s) => `${s.label} ${s.grams}g`).join(', ')}`
              : ''),
        )
        .join('\n'),
    );
  }

  if (name === 'log_food') {
    const parsed = logArgs.safeParse(args ?? {});
    if (!parsed.success)
      return text(`Invalid arguments: ${parsed.error.message}`, true);
    const a = parsed.data;

    let food: typeof foods.$inferSelect | undefined;
    // Not identical, but close enough to mention once the entry is in: a nudge
    // towards search_foods next time rather than a refusal of a fair call.
    let nearby: string[] = [];

    if (a.foodId) {
      [food] = await db.select().from(foods).where(eq(foods.id, a.foodId)).limit(1);
      if (!food) return text(`No food with id ${a.foodId}. Try search_foods.`, true);
    } else {
      const complete =
        a.name !== undefined &&
        a.kcal100g !== undefined &&
        a.protein100g !== undefined &&
        a.carbs100g !== undefined &&
        a.fat100g !== undefined;
      if (!complete) {
        return text(
          'To log a food that is not in the database, give name plus all four ' +
            'of kcal100g, protein100g, carbs100g and fat100g. Otherwise pass a ' +
            'foodId from search_foods.',
          true,
        );
      }
      // Logging by name is how duplicates get made: an agent that skips
      // search_foods invents macros for something already in the database,
      // and a week later there are four Havregryn with four different
      // numbers. Refuse the obvious case and hand back the ids instead.
      const existing = await searchLocal(db, owner.id, a.name as string, 10);
      const already = existing.filter((f) => sameName(f.name, a.name as string));
      let similar = existing.filter((f) => !sameName(f.name, a.name as string));
      if (similar.length === 0) {
        // searchLocal matches the whole query as one substring, so "Havregryn
        // grov" finds nothing even with three Havregryn in the table. Try the
        // longest word alone, which is the part carrying the meaning.
        const word = (a.name as string)
          .split(/\s+/)
          .filter((w) => w.length >= 4)
          .sort((x, y) => y.length - x.length)[0];
        if (word && word !== a.name) {
          similar = await searchLocal(db, owner.id, word, 5);
        }
      }
      nearby = similar.slice(0, 3).map(describe);

      if (already.length > 0 && !a.createNew) {
        return text(
          `"${a.name}" is already in the database:\n` +
            already.map((f) => `  ${describe(f)}`).join('\n') +
            '\n\nLog it with foodId so the amounts stay consistent with what ' +
            'is already there. If this really is a different food, repeat the ' +
            'call with createNew: true.',
          true,
        );
      }

      food = await db.transaction(async (tx) => {
        const row = await insertCustomFood(tx, owner.id, {
          name: a.name as string,
          brand: a.brand ?? null,
          kcal100g: a.kcal100g as number,
          protein100g: a.protein100g as number,
          carbs100g: a.carbs100g as number,
          fat100g: a.fat100g as number,
        });
        await recordFoodView(tx, owner.id, row.id);
        return row;
      });
    }

    const loggedOn = a.date ?? toDateKey();
    if (!isEditableDay(loggedOn)) {
      return text(refuseDay(loggedOn), true);
    }
    const macros = snapshotFor(food, a.grams);
    await db.insert(logEntries).values({
      userId: owner.id,
      foodId: food.id,
      loggedOn,
      meal: a.meal as Meal,
      grams: a.grams,
      kcal: macros.kcal,
      proteinG: macros.proteinG,
      carbsG: macros.carbsG,
      fatG: macros.fatG,
    });

    return text(
      `Logged ${a.grams}g of ${food.name} to ${a.meal} on ${loggedOn}: ` +
        `${macros.kcal} kcal, ${macros.proteinG}g protein, ` +
        `${macros.carbsG}g carbs, ${macros.fatG}g fat.` +
        (nearby.length > 0
          ? '\n\nSimilar foods were already here:\n' +
            nearby.map((n) => `  ${n}`).join('\n') +
            '\nSearch first next time, and log by foodId when one of them is it.'
          : ''),
    );
  }

  if (name === 'get_day') {
    const parsed = dayArgs.safeParse(args ?? {});
    if (!parsed.success)
      return text(`Invalid arguments: ${parsed.error.message}`, true);
    const date = parsed.data.date ?? toDateKey();
    if (!isEditableDay(date)) return text(refuseDay(date), true);
    const entries = await entriesForRange(db, owner.id, date, date);
    const totals = totalsOf(entries);
    const goal = await goalOn(db, owner.id, date);

    if (entries.length === 0) {
      return text(`Nothing logged yet on ${date}.`);
    }

    const byMeal = MEALS.map((meal) => {
      const rows = entries.filter((e) => e.meal === meal);
      if (rows.length === 0) return null;
      return `${meal}:\n${rows
        .map(
          (e) =>
            `  ${e.food.name} — ${e.grams}g, ${Math.round(e.kcal)} kcal [id ${e.id}]`,
        )
        .join('\n')}`;
    }).filter(Boolean);

    const summary =
      `${date}: ${totals.kcal} kcal, ${totals.proteinG}g protein, ` +
      `${totals.carbsG}g carbs, ${totals.fatG}g fat` +
      (goal
        ? ` (goal ${goal.calories} kcal, ${goal.proteinG}g protein, ` +
          `${goal.carbsG}g carbs, ${goal.fatG}g fat — ` +
          `${Math.round(goal.calories - totals.kcal)} kcal left)`
        : ' (no goal set)');

    return text(`${summary}\n\n${byMeal.join('\n')}`);
  }

  if (name === 'move_entry' || name === 'delete_entry') {
    const parsed =
      name === 'move_entry'
        ? moveArgs.safeParse(args ?? {})
        : deleteArgs.safeParse(args ?? {});
    if (!parsed.success)
      return text(`Invalid arguments: ${parsed.error.message}`, true);
    const a = parsed.data;

    // Scoped to the owner as well as the id: a token must not be able to
    // reach a row by guessing at a uuid from another account.
    const [row] = await db
      .select({ entry: logEntries, food: foods })
      .from(logEntries)
      .innerJoin(foods, eq(foods.id, logEntries.foodId))
      .where(and(eq(logEntries.id, a.entryId), eq(logEntries.userId, owner.id)))
      .limit(1);

    if (!row) return text(`No entry with id ${a.entryId}. Try get_day.`, true);
    // Where it is now has to be in range too, or an old day could be emptied
    // one entry at a time without ever naming its date.
    if (!isEditableDay(row.entry.loggedOn)) {
      return text(refuseDay(row.entry.loggedOn), true);
    }

    if (name === 'delete_entry') {
      await db.delete(logEntries).where(eq(logEntries.id, a.entryId));
      return text(
        `Removed ${row.entry.grams}g of ${row.food.name} from ` +
          `${row.entry.meal} on ${row.entry.loggedOn}.`,
      );
    }

    const move = a as z.infer<typeof moveArgs>;
    const loggedOn = move.date ?? row.entry.loggedOn;
    if (!isEditableDay(loggedOn)) return text(refuseDay(loggedOn), true);

    const meal = move.meal ?? row.entry.meal;
    const grams = move.grams ?? row.entry.grams;
    // Re-snapshotted from the food, the same as the app does, so a corrected
    // amount carries corrected macros rather than the old ones scaled.
    const macros = snapshotFor(row.food, grams);

    await db
      .update(logEntries)
      .set({ loggedOn, meal, grams, ...macros })
      .where(eq(logEntries.id, a.entryId));

    return text(
      `${row.food.name} is now ${grams}g in ${meal} on ${loggedOn}: ` +
        `${macros.kcal} kcal, ${macros.proteinG}g protein, ` +
        `${macros.carbsG}g carbs, ${macros.fatG}g fat.`,
    );
  }

  return text(`Unknown tool: ${name}`, true);
}

/**
 * Access tokens are 43-character base64url; secret phrases are words a person
 * chose. The distinction only decides whether a failure counts as a guess.
 */
const looksLikeOAuthToken = (value: string): boolean =>
  /^[A-Za-z0-9_-]{43}$/.test(value);

/* --------------------------------------------------------------- handler --- */

export const mcpRoutes: FastifyPluginAsync<AppDeps> = async (app, deps) => {
  const { db } = deps;

  // The spec's GET is for server-initiated messages over SSE. Nothing here
  // pushes, so 405 is the correct answer.
  app.get('/mcp', async (_req, reply) => reply.status(405).send());

  // The secret is a memorable phrase, so wrong guesses -- not request volume
  // -- are the threat. Fastify's limiter keys on the address, which is the
  // right key for a flood but the wrong one for guessing: behind a reverse
  // proxy every client shares an address. The guessing budget is enforced
  // separately, below, and counts only failures.
  const attempts = new AttemptLimiter();
  const mcpUrl = `${deps.env.PUBLIC_URL}/mcp`;
  const resourceMetadataUrl = `${deps.env.PUBLIC_URL}/.well-known/oauth-protected-resource`;

  app.post(
    '/mcp',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const header = req.headers.authorization ?? '';
      const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

      // Two ways in. An OAuth access token is what Claude's connector flow
      // produces and is checked first because it is the common case and the
      // cheaper lookup; a secret phrase is the manual route, for Claude Code
      // and scripts. Both land on the same owner.
      let owner: TokenOwner | null = null;
      if (presented) {
        const bearer = await resolveAccessToken(db, presented, mcpUrl);
        owner = bearer
          ? {
              id: bearer.id,
              email: bearer.email,
              displayName: bearer.displayName,
              tokenId: bearer.tokenId,
            }
          : await resolveToken(db, presented);
      }

      if (!owner) {
        if (attempts.blocked(req.ip)) {
          return reply
            .status(429)
            .header('retry-after', String(attempts.retryAfter(req.ip)))
            .send({ error: 'Too many failed attempts. Try again later.' });
        }
        // Only a wrong phrase counts against the guessing budget. An expired
        // access token is an ordinary event -- Claude refreshes reactively on
        // a 401 -- and must never push anyone towards a lockout.
        if (!looksLikeOAuthToken(presented)) attempts.fail(req.ip);
        req.log.warn({ ip: req.ip }, 'mcp auth failed');
        return (
          reply
            .status(401)
            // RFC 9728: this pointer is how a client discovers where to sign
            // in. Without it Claude has nothing to go on and falls back to
            // guessing well-known paths.
            .header(
              'www-authenticate',
              `Bearer realm="eats", ` +
                `resource_metadata="${resourceMetadataUrl}", ` +
                `scope="${SCOPE}"`,
            )
            .send({ error: 'Authorization required.' })
        );
      }

      // Absent means the pre-header protocol version, which is still supported.
      const version = req.headers['mcp-protocol-version'];
      if (typeof version === 'string' && !SUPPORTED_VERSIONS.has(version)) {
        return reply.status(400).send({ error: `Unsupported MCP version ${version}.` });
      }

      const body = req.body;
      if (typeof body !== 'object' || body === null) {
        return reply
          .status(400)
          .send(rpcError(null, JSONRPC_PARSE_ERROR, 'Parse error'));
      }

      const message = body as {
        jsonrpc?: string;
        id?: Id;
        method?: string;
        params?: unknown;
      };

      // No id means a notification or a response: acknowledge, return nothing.
      if (message.id === undefined) return reply.status(202).send();

      const id = message.id ?? null;
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return rpcError(id, JSONRPC_INVALID_REQUEST, 'Invalid Request');
      }

      try {
        switch (message.method) {
          case 'initialize': {
            const asked = (message.params as { protocolVersion?: string } | undefined)
              ?.protocolVersion;
            return rpcResult(id, {
              // Echo the client's version when we speak it, else offer ours.
              protocolVersion:
                asked && SUPPORTED_VERSIONS.has(asked) ? asked : PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'eats', title: 'Eats', version: '1.0.0' },
              instructions:
                `Food and macro tracking for ${owner.displayName}. Amounts ` +
                'are always grams and nutrition is always per 100g.\n\n' +
                'Call search_foods before log_food, every time. Logging by ' +
                'name creates a new food, so inventing macros for something ' +
                'already in the database leaves two copies of it carrying ' +
                'different numbers. Log by foodId whenever a search finds the ' +
                'thing you mean.\n\n' +
                'Today and yesterday are the only days that can be read or ' +
                'changed from here.',
            });
          }

          case 'ping':
            return rpcResult(id, {});

          case 'tools/list':
            return rpcResult(id, { tools: TOOLS });

          case 'tools/call': {
            const params = message.params as
              { name?: unknown; arguments?: unknown } | undefined;
            if (typeof params?.name !== 'string') {
              return rpcError(id, JSONRPC_INVALID_PARAMS, 'Missing tool name');
            }
            if (!TOOLS.some((t) => t.name === params.name)) {
              return rpcError(
                id,
                JSONRPC_INVALID_PARAMS,
                `Unknown tool: ${params.name}`,
              );
            }
            const result = await callTool(db, owner, params.name, params.arguments);
            req.log.info(
              {
                tool: params.name,
                tokenId: owner.tokenId,
                isError: result.isError,
              },
              'mcp tool call',
            );
            return rpcResult(id, result);
          }

          default:
            return rpcError(
              id,
              JSONRPC_METHOD_NOT_FOUND,
              `Method not found: ${message.method}`,
            );
        }
      } catch (err) {
        req.log.error({ err, method: message.method }, 'mcp request failed');
        return rpcError(id, JSONRPC_INTERNAL_ERROR, 'Internal error');
      }
    },
  );
};
