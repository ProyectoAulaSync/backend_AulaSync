import { Router } from 'express';
import { chooseUsername, syncGoogle } from '../controllers/google.controller';
import { authenticate } from '../middlewares/authenticate';

const router = Router();

router.post('/google', authenticate, syncGoogle);
router.put('/username', authenticate, chooseUsername);

export default router;
