/**
 * Service Layer Exports
 *
 * All business logic flows through services.
 * Services handle authorization, validation, and event emission.
 */

export { createServiceContext, createSystemContext } from './context';
export { documentService, DocumentService } from './DocumentService';
export { groupService, GroupService } from './GroupService';
export { questionService, QuestionService } from './QuestionService';
export { roomService, RoomService } from './RoomService';

export type {
  CreateServiceContextOptions,
  FilterOptions,
  PaginatedResult,
  PaginationOptions,
  ServiceContext,
  SortOptions,
} from './types';

export type {
  DocumentListOptions,
  DocumentWithVersion,
  FileInput,
  UploadOptions,
} from './DocumentService';

export type {
  CreateGroupOptions,
  GroupListOptions,
  GroupMemberInfo,
  GroupWithCount,
  UpdateGroupOptions,
} from './GroupService';

export type {
  CreateQuestionOptions,
  CreateViewerQuestionOptions,
  QuestionListOptions,
  QuestionWithAnswers,
  QuestionWithMeta,
  UpdateQuestionOptions,
} from './QuestionService';

export type {
  CreateRoomOptions,
  RoomListOptions,
  RoomWithStats,
  UpdateRoomOptions,
} from './RoomService';
