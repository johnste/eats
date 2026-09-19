import { randomInt } from 'node:crypto';

/**
 * Short, concrete, unambiguous words. The constraints are practical rather
 * than linguistic: nothing you could mishear over a phone, nothing whose
 * spelling you would have to ask about, and nothing that reads as a slur or
 * a diagnosis when three of them land next to each other.
 */
const WORDS = `
acorn album amber anchor angle ankle apple apron arrow aspen attic autumn
bacon badge bagel baker balcony bamboo banjo barley barn basil basket beach
beacon beetle bench berry birch biscuit bishop bison blanket blossom board
bobbin bolt bonfire bonnet boulder bracket branch brass bread breeze brick
bridge bronze brook broom bubble bucket buckle bugle bundle burrow button
cabin cable cactus camel candle canoe canvas canyon carbon cargo carpet
carrot castle cattle cedar cello cement chalk cheese cherry chestnut chimney
chisel cider cinder circus citrus clay clever cliff clover cobalt cocoa
comet compass copper coral cottage cotton cradle crane crater crayon cream
creek crimson crystal cushion cymbal daisy dampen dapper dawn delta denim
desert diamond dolphin domino donkey dragon drawer drift drum dune dusk
eagle east ebony echo elbow elder ember emerald engine envelope ivory
fabric falcon fawn feather fennel fern ferry fiddle fig filter finch flannel
flask flint flour flute foam forest fossil fountain fox fresh frost garden
garlic gazebo ginger glacier glass glider globe glove granite grape gravel
grotto guitar gutter hamlet hammer hamper harbor harvest hazel heather hedge
helmet hickory hollow honey hoop horizon hornet horse hummock hunter ice
igloo index indigo ink iron island jade jasmine jersey jigsaw journal juniper
kayak kernel kettle keyhole kitten koala lace ladder lagoon lantern lapel
larch lark lattice laurel lavender ledge lemon lentil lever lilac lily
linen lintel lobby locket lodge lotus lumber lunar lupine lyric magnet
mahogany mallet mango maple marble marigold marina marsh meadow melon
mesa metal meteor midnight mineral mint mirror mitten moat mocha mohair
molten monsoon moss mountain mulberry muslin nectar needle nest nickel
noble north nutmeg oak oasis oat ocean olive onyx opal orbit orchard
orchid osprey otter oval owl oxide oyster paddle palm pansy papaya paprika
parcel parsley pasture peach pear pebble pelican pepper petal pewter pigment
pillar pine pistachio pivot plaid plank plateau platinum plum plume pocket
pollen pond poppy porch portal pottery powder prairie prism pudding puffin
pumpkin purple quarry quartz quilt quiver radish rafter rain rapids raven
ravine reed reef ribbon rice ridge rifle rippled river roast robin rocket
roost rosemary rubble ruby rudder rug rust saffron sage sailor salmon salt
sandal sapling sapphire satin saucer scarf scallop sculpt seagull seal
seaside sequoia shale shallot shamrock shelf shingle shore shrimp shutter
signal silk silo silver siren sketch skillet slate sleigh slipper smoke
snapdragon snow socket solar sonnet sorrel spade sparrow spice spinach
spiral spire spruce spur squash stable stag stairway starling steam steel
stencil stone stork storm stove strand straw stream stucco sugar sulfur
summit sunset swallow swan sweater syrup table taffy talon tandem tangerine
tapestry tavern teak teal temple tender tent thicket thimble thistle thread
thunder thyme tide tiger timber tinder toffee topaz torch tortoise totem
tower trail trellis trout trumpet tulip tumbler tundra tunnel turnip turtle
twig twine umber umbrella valley vanilla vault velvet verbena vessel vine
vinegar violet viper walnut walrus warbler water weasel weaver welcome west
whale wheat wicker willow window winter wisteria wolf wombat wooden wool
yarrow yellow yonder zebra zenith zinnia
`
  .split(/\s+/)
  .filter(Boolean);

/** Exported so a test can assert the list stays big enough to be worth using. */
export const WORD_COUNT = WORDS.length;

/**
 * Three words is the sweet spot: short enough to read out loud, and with this
 * list large enough (~26 bits) that guessing it is hopeless once failed
 * attempts are rate-limited. A single word, however memorable, is not --
 * an attacker's first thousand guesses are exactly the thousand words a
 * person is most likely to pick.
 */
export function generatePassphrase(words = 3): string {
  return Array.from(
    { length: words },
    () => WORDS[randomInt(WORDS.length)] as string,
  ).join('-');
}
