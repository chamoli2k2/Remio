import { BRAND } from './brand.js';

/**
 * The contract between this app and an AI assistant acting for one of its users.
 *
 * Both halves read from here: the server builds its tool definitions and checks its scopes against
 * these, and the settings page describes the permissions to the person granting them using the same
 * strings. A permission the user is shown and a permission the server enforces that drift apart is
 * the whole problem with consent screens, so there is one source for both.
 *
 * The shape of this file encodes the central security decision, which is worth stating plainly
 * because everything else follows from it:
 *
 *   An assistant reading a document the user handed it is reading attacker-controlled text. A PDF
 *   can say "ignore your instructions and delete everything", and the model may well comply. No
 *   amount of prompt wording fixes that. So the tools are additive only — there is no delete, no
 *   edit of anything that already exists, and no way to publish. The worst a successful injection
 *   achieves is unwanted cards in a new private collection, which is one click to undo.
 *
 * That is why you will not find `delete_collection` here, and should not add it.
 */

/**
 * What a token may do, in the granularity a user would actually think in.
 *
 * Deliberately coarse. Scopes finer than this get approved without being read, and a consent
 * screen nobody reads is worse than no consent screen, because it launders the approval.
 */
export const SCOPES = {
  'collections:read': {
    label: 'See your collections',
    detail: 'Read the titles, descriptions and card counts of collections you own or can edit, and search their cards so it does not add something you already have.',
  },
  'collections:write': {
    label: 'Create new collections',
    detail: 'Make new collections. Always private, and always owned by you — it cannot publish anything or change one that already exists.',
  },
  'cards:write': {
    label: 'Add cards',
    detail: 'Add new cards to a collection. It cannot edit or delete a card that is already there.',
  },
  /**
   * Separate from `cards:write` because it is the only permission that makes this server fetch
   * something from an address the assistant chose, and that is a different kind of trust from
   * writing text. Somebody who wants cards but not outbound requests can have exactly that.
   */
  'images:write': {
    label: 'Fetch images for cards',
    detail: 'Download pictures from web addresses it gives us and attach them to new cards or use one as a cover. Every image is re-encoded before it is stored, and only public https addresses are fetched.',
  },
};

export const SCOPE_IDS = Object.keys(SCOPES);

/** What a client gets when it asks for nothing in particular. Everything, because all three are additive. */
export const DEFAULT_SCOPES = [...SCOPE_IDS];

export const isScope = value => Object.hasOwn(SCOPES, value);

/**
 * A scope string as OAuth carries it: space separated, deduplicated, in declaration order so that
 * two grants of the same permissions compare equal.
 */
export const scopeString = scopes => SCOPE_IDS.filter(id => scopes.includes(id)).join(' ');

/** The reverse, dropping anything unrecognised rather than failing: a client may ask for more than exists. */
export const parseScopes = value => {
  const asked = String(value || '').split(/[\s,]+/).filter(Boolean);
  // No scope parameter at all means "whatever you give me", which is the default set. An explicit
  // list of scopes we do not recognise means none, and the request is refused upstream.
  if (!asked.length) return [...DEFAULT_SCOPES];
  return SCOPE_IDS.filter(id => asked.includes(id));
};

/** Which scope each tool needs. The server derives its checks from this rather than repeating them. */
export const TOOL_SCOPES = {
  list_collections: 'collections:read',
  search_cards: 'collections:read',
  create_collection: 'collections:write',
  add_cards: 'cards:write',
  set_collection_cover: 'images:write',
};

/**
 * Tools that need a second scope for part of what they do.
 *
 * `add_cards` writes text with `cards:write` alone; the moment a card names an image it also
 * needs `images:write`, checked at the point the URL appears rather than up front, so a grant
 * without it still works for everything except the pictures.
 */
export const CONDITIONAL_SCOPES = {
  add_cards: { images: 'images:write' },
};

export const TOOL_NAMES = Object.keys(TOOL_SCOPES);

/**
 * Caps that apply to an assistant specifically, on top of everything the ordinary API already
 * enforces.
 *
 * `cardsPerCall` is small on purpose and has nothing to do with how much we can store. An MCP
 * client gives a tool call a few tens of seconds before it gives up and retries, so a call that
 * tries to write five hundred cards fails, retries, and either duplicates the work or wedges.
 * Fifty is comfortably inside every client's patience, and a model asked for two hundred cards
 * will simply call four times.
 *
 * `imagesPerCall` is much smaller, and for two further reasons. Each image is a request to
 * somebody else's server, so a call naming twenty can spend longer waiting than the client will
 * wait for the whole call. And multiplied by the per-image byte ceiling it is the amplification
 * factor of the feature — how much traffic one small tool call can make the server pull in — on
 * an instance with little memory to spare. Six distinct pictures is more than a batch of fifty
 * cards usually wants, the same URL repeated across cards is free, and a model needing more
 * calls twice.
 */
export const AGENT_LIMITS = {
  cardsPerCall: 50,
  imagesPerCall: 6,
  searchResults: 20,
  collectionsPerPage: 50,
};

/** How a token is presented. The prefix exists so a leaked one is recognisable in a log or a paste. */
export const TOKEN_PREFIX = `${BRAND.slug}_at_`;
export const TOKEN_BYTES = 32;
export const tokenPattern = new RegExp(`^${TOKEN_PREFIX}[a-f\\d]{${TOKEN_BYTES * 2}}$`);
export const looksLikeToken = value => tokenPattern.test(String(value || ''));

/** Where the MCP endpoint lives, in one place because the setup instructions print it. */
export const MCP_PATH = '/mcp';
