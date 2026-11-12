/**
 * Every model, one file each. Import from here; the files themselves hold only their own schema,
 * indexes and the notes on why. Names a model refers to are strings (see `ref` in _shared.js), so
 * model files never import one another.
 */
export { EmailCode } from './EmailCode.js';
export { NoteCollection } from './NoteCollection.js';
export { Notebook } from './Notebook.js';
export { Note } from './Note.js';
export { NoteRevision } from './NoteRevision.js';
export { User } from './User.js';
export { RefreshToken } from './RefreshToken.js';
export { AuthToken } from './AuthToken.js';
export { Folder } from './Folder.js';
export { Card } from './Card.js';
export { Media } from './Media.js';
export { Progress } from './Progress.js';
export { Review } from './Review.js';
export { GameProfile } from './GameProfile.js';
export { Activity } from './Activity.js';
export { Revision } from './Revision.js';
export { DomainEvent } from './DomainEvent.js';
export { CardDoc } from './CardDoc.js';
export { Relationship } from './Relationship.js';
export { Project } from './Project.js';
export { PremiumOrder } from './PremiumOrder.js';
export { Notification } from './Notification.js';
export { Team } from './Team.js';
export { TeamMember } from './TeamMember.js';
export { TeamInvite } from './TeamInvite.js';
export { Assignment } from './Assignment.js';
export { Setting } from './Setting.js';
export { AuditEntry } from './AuditEntry.js';
export { ContentReport } from './ContentReport.js';
export { AgentToken } from './AgentToken.js';
export { AgentBatch } from './AgentBatch.js';
export { OAuthClient } from './OAuthClient.js';
export { OAuthGrant } from './OAuthGrant.js';
export { Blob } from './Blob.js';

import { EmailCode } from './EmailCode.js';
import { NoteCollection } from './NoteCollection.js';
import { Notebook } from './Notebook.js';
import { Note } from './Note.js';
import { NoteRevision } from './NoteRevision.js';
import { User } from './User.js';
import { RefreshToken } from './RefreshToken.js';
import { AuthToken } from './AuthToken.js';
import { Folder } from './Folder.js';
import { Card } from './Card.js';
import { Media } from './Media.js';
import { Progress } from './Progress.js';
import { Review } from './Review.js';
import { GameProfile } from './GameProfile.js';
import { Activity } from './Activity.js';
import { Revision } from './Revision.js';
import { DomainEvent } from './DomainEvent.js';
import { CardDoc } from './CardDoc.js';
import { Relationship } from './Relationship.js';
import { Project } from './Project.js';
import { PremiumOrder } from './PremiumOrder.js';
import { Notification } from './Notification.js';
import { Team } from './Team.js';
import { TeamMember } from './TeamMember.js';
import { TeamInvite } from './TeamInvite.js';
import { Assignment } from './Assignment.js';
import { Setting } from './Setting.js';
import { AuditEntry } from './AuditEntry.js';
import { ContentReport } from './ContentReport.js';
import { AgentToken } from './AgentToken.js';
import { AgentBatch } from './AgentBatch.js';
import { OAuthClient } from './OAuthClient.js';
import { OAuthGrant } from './OAuthGrant.js';
import { Blob } from './Blob.js';

/** Every model, in the order their indexes are built at startup. */
export const allModels = [EmailCode, NoteCollection, Notebook, Note, NoteRevision, User, RefreshToken, AuthToken, Folder, Card, Media, Progress, Review, GameProfile, Activity, Revision, DomainEvent, CardDoc, Relationship, Project, PremiumOrder, Notification, Team, TeamMember, TeamInvite, Assignment, Setting, AuditEntry, ContentReport, AgentToken, AgentBatch, OAuthClient, OAuthGrant, Blob];
