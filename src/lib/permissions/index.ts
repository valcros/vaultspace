export { PermissionEngine, getPermissionEngine } from './PermissionEngine';
export type { Actor, Resource, Action, PermissionResult } from './PermissionEngine';
export {
  admitLinkViewer,
  canLinkAccessResource,
  canViewerLinkAccessDocument,
  evaluateLinkAdmission,
  evaluateLinkServe,
  evaluateLinkState,
  getLinkPolicyRecord,
  getViewerLinkScopedDocumentIds,
  linkPermissionLevel,
  linkPolicySelect,
} from './LinkPolicy';
export type {
  LinkAdmissionInput,
  LinkAdmissionResult,
  LinkPolicyAction,
  LinkPolicyDecision,
  LinkPolicyDenialCode,
  LinkPolicyRecord,
  LinkResourceTarget,
  LinkServeSession,
} from './LinkPolicy';
