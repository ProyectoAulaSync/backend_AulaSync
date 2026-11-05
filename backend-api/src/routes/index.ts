import { Router } from 'express';
import { getHealth } from '../controllers/healthController';
import { getMensaje } from '../controllers/mensajeController';

const router = Router();

router.get('/health', getHealth);
router.get('/api/mensaje', getMensaje);

export default router;
