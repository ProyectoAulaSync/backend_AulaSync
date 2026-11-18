import type { RoomCreateInput, RoomUpdateInput } from '../schemas/room.schema';
import type { Room } from '../types/room';
import * as roomRepo from '../repositories/room.repository';
import { profileNotFound } from '../errors/userErrors';

export async function createRoomService(nombre: string, anfitriónId: string) {
  const profile = await roomRepo.findProfileByUid(anfitriónId);
  if (!profile) throw profileNotFound();
  return roomRepo.createRoom(nombre, anfitriónId);
}

export async function listMyRoomsService(uid: string) {
  return roomRepo.listRoomsByHost(uid);
}

export async function updateRoomService(roomId: string, data: RoomUpdateInput, uid: string) {
  return roomRepo.updateRoom(roomId, data.nombre, uid);
}

export async function deleteRoomService(roomId: string, uid: string) {
  return roomRepo.deleteRoom(roomId, uid);
}

export async function joinRoomService(roomId: string, uid: string) {
  return roomRepo.addMember(roomId, uid);
}

export async function listRoomMembersService(roomId: string) {
  return roomRepo.listMembers(roomId);
}

export async function findRoomById(roomId: string): Promise<Room | null> {
  return roomRepo.findRoomById(roomId);
}

