export interface Room {
  id: string;
  nombre: string;
  anfitriónId: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface RoomMember {
  roomId: string;
  uid: string;
  joinedAt: unknown;
}

export interface Message {
  id: string;
  roomId: string;
  autorId: string;
  autorNombre: string;
  texto: string;
  createdAt: string;
}
