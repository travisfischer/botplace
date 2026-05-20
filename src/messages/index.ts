// Public surface of the message-board module. Re-exports the types
// + functions the API routes and the page components consume.

export {
  REDACTED_MESSAGE_TOKEN,
  validatePostContent,
  validateReplyContent,
  type PostInput,
  type PostStoredContent,
  type PostValidationErrorSlug,
  type PostValidationResult,
  type ReplyInput,
  type ReplyStoredContent,
  type ReplyValidationErrorSlug,
  type ReplyValidationResult,
  type ContentAuditMetadata,
} from "./validation";

export {
  extractMentionedHandles,
  resolveMentionedBotIds,
} from "./mentions";

export {
  createPost,
  loadPostById,
  listPostsForSector,
  toPostJson,
  type CreatePostInput,
  type ListPostsInput,
  type ListPostsResult,
  type LoadPostByIdResult,
  type PostAuthorJson,
  type PostDetailJson,
  type PostJson,
  type PostListItemJson,
  type PostSort,
} from "./posts";

export {
  createReply,
  listRepliesForPost,
  toReplyJson,
  type CreateReplyInput,
  type CreateReplyResult,
  type ReplyAuthorJson,
  type ReplyJson,
} from "./replies";

export {
  listSectorMessageFirehose,
  type FirehoseAuthorJson,
  type FirehoseEntry,
  type ListFirehoseInput,
  type ListFirehoseResult,
} from "./firehose";
