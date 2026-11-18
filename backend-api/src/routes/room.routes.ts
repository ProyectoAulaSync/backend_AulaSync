import { Router } from 'express';
import {
  createRoom,
  listMyRooms,
  updateRoom,
  deleteRoom,
  joinRoom,
  listMembers,
} from '../controllers/room.controller';
import { authenticate, requireCompleteProfile } from '../middlewares/authenticate';

const router = Router();

router.use(authenticate);
router.use(requireCompleteProfile);

router.post('/', createRoom);
router.get('/', listMyRooms);
router.patch('/:roomId', updateRoom);
router.delete('/:roomId', deleteRoom);
router.post('/:roomId/join', joinRoom);
router.get('/:roomId/members', listMembers);

export default router;
