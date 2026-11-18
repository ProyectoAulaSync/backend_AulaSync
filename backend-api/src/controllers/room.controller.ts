import type { Request, Response } from 'express';
import { getAuthContext } from '../middlewares/authenticate';
import * as roomService from '../services/room.service';
import { roomCreateSchema, roomUpdateSchema } from '../schemas/room.schema';

export const createRoom = async (req: Request, res: Response): Promise<void> => {
  const { nombre } = roomCreateSchema.parse(req.body);
  const uid = getAuthContext(res).uid;
  const room = await roomService.createRoomService(nombre, uid);
  res.status(201).json(room);
};

export const listMyRooms = async (_req: Request, res: Response): Promise<void> => {
  const uid = getAuthContext(res).uid;
  const rooms = await roomService.listMyRoomsService(uid);
  res.json(rooms);
};

export const updateRoom = async (req: Request, res: Response): Promise<void> => {
  const roomId = String(req.params.roomId);
  const { nombre } = roomUpdateSchema.parse(req.body);
  const uid = getAuthContext(res).uid;
  const room = await roomService.updateRoomService(roomId, { nombre }, uid);
  res.json(room);
};

export const deleteRoom = async (req: Request, res: Response): Promise<void> => {
  const roomId = String(req.params.roomId);
  const uid = getAuthContext(res).uid;
  await roomService.deleteRoomService(roomId, uid);
  res.status(204).send();
};

export const joinRoom = async (req: Request, res: Response): Promise<void> => {
  const roomId = String(req.params.roomId);
  const uid = getAuthContext(res).uid;
  await roomService.joinRoomService(roomId, uid);
  res.status(201).json({ roomId, uid });
};

export const listMembers = async (req: Request, res: Response): Promise<void> => {
  const roomId = String(req.params.roomId);
  const members = await roomService.listRoomMembersService(roomId);
  res.json(members);
};
