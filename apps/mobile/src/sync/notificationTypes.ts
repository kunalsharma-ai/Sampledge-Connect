/** Notification feed shapes from the shared contracts, under names that do not clash with the DOM. */
export type {
  MarkNotificationsReadRequest,
  Notification as ServerNotification,
  NotificationKind,
  NotificationPage as ListNotificationsResponse,
} from '@sampledge/contracts';

export interface ListNotificationsQuery {
  unread?: boolean;
  before?: string;
  limit?: number;
}

export interface MarkNotificationsReadResponse {
  unreadCount: number;
}
