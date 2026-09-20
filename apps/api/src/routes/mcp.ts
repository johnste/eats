import { MEALS, scaleMacros, toDateKey, type Meal } from '@eats/shared';
import { eq } from 'drizzle-orm';
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

export const searchArgs = z.object({
  query: z.string().min(1).max(100),
});

export const logArgs = z.object({
  grams: z.number().positive().max(5000),
  meal: z.enum(MEALS),
  foodId: z.uuid().optional(),
  /** For food not in the database: supply a name and per-100g macros. */
  name: z.string().min(1).max(200).optional(),
  brand: z.string().max(120).optional(),
  kcal100g: z.number().min(0).max(900).optional(),
  protein100g: z.number().min(0).max(100).optional(),
  carbs100g: z.number().min(0).max(100).optional(),
  fat100g: z.number().min(0).max(100).optional(),
});

export const TOOLS = [
  {
    name: 'search_foods',
    title: 'Search foods',
    description:
      'Find a food already known to the app, by name or brand. Covers foods the ' +
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
    name: 'get_today',
    title: "Read today's log",
    description:
      "Read back everything logged today: totals, the day's goal if one is set, " +
      'and each entry grouped by meal. Use it to confirm what you logged, or to ' +
      'answer questions about how the day is going.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

/* -------------------------------------------------------------- execution --- */

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

    const loggedOn = toDateKey();
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
      `Logged ${a.grams}g of ${food.name} to ${a.meal}: ${macros.kcal} kcal, ` +
        `${macros.proteinG}g protein, ${macros.carbsG}g carbs, ${macros.fatG}g fat.`,
    );
  }

  if (name === 'get_today') {
    const date = toDateKey();
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
        .map((e) => `  ${e.food.name} — ${e.grams}g, ${Math.round(e.kcal)} kcal`)
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
                `Food and macro tracking for ${owner.displayName}. Amounts are ` +
                'always grams and nutrition is always per 100g. Search before ' +
                'logging so an existing food is reused rather than duplicated. ' +
                'Only entries for today can be added here.',
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
