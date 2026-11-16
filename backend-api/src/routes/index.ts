import { Router } from 'express';
import { getHealth } from '../controllers/healthController';
import { getMensaje } from '../controllers/mensajeController';
import userRoutes from './user.routes'; // TS-01
import registerRoutes from './register.routes'; // US-01
import googleRoutes from './google.routes'; // US-02
import roomRoutes from './room.routes'; // US-06, US-07, US-08
import messageRoutes from './message.routes'; // US-10, US-11

const router = Router();

router.get('/health', getHealth);
router.get('/api/mensaje', getMensaje);

router.use('/api/users', userRoutes); // TS-01
router.use('/api/auth', registerRoutes); // US-01
router.use('/api/auth', googleRoutes); // US-02
router.use('/api/rooms', roomRoutes); // US-06, US-07, US-08
router.use('/api/rooms', messageRoutes); // US-10, US-11

export default router;
