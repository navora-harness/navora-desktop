import type {ChatSession,PermissionRequest} from './types'

/** Keep incoming approvals ordered while exposing only the active chat and its sub-chats. */
export function permissionRequestsForChat(requests:PermissionRequest[],activeChatId:string|null,chats:Pick<ChatSession,'id'|'kind'|'parentChatId'>[]):PermissionRequest[]{
  if(!activeChatId)return []
  const visibleChatIds=new Set([activeChatId,...chats.filter(chat=>chat.kind==='sub'&&chat.parentChatId===activeChatId).map(chat=>chat.id)])
  return requests.filter(request=>visibleChatIds.has(request.chatId))
}
