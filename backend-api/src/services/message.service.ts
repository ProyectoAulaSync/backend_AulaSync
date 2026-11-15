import type { MessageCreateInput } from '../schemas/message.schema';
import * as roomRepo from '../repositories/room.repository';
import * as userRepo from '../repositories/user.repository';

export async function sendMessageService(roomId: string, input: MessageCreateInput, autorNombre: string) {
  return roomRepo.saveMessage(roomId, input.roomId, autorNombre, input.texto);
}

export async function getHistoryService(roomId: string, limit?: number) {
  return roomRepo.listMessages(roomId, limit);
}

export async function resolveAutorNombre(uid: string): Promise<string> {
  const profile = await userRepo.findByUid(uid);
  return profile ? `${profile.nombres} ${profile.apellidos}` : 'Usuario';
}
