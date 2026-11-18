import { Router } from 'express';
import { sendMessage, getHistory } from '../controllers/message.controller';
import { authenticate } from '../middlewares/authenticate';

const router = Router();

router.use(authenticate);

router.post('/:roomId/messages', sendMessage);
router.get('/:roomId/messages', getHistory);

export default router;
