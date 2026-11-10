import { Router } from 'express';
import { checkUsername, getMe, patchMe } from '../controllers/user.controller';
import { authenticate, requireCompleteProfile } from '../middlewares/authenticate';

const router = Router();

router.get('/username-available', checkUsername);
router.get('/me', authenticate, getMe);
router.patch('/me', authenticate, requireCompleteProfile, patchMe);

export default router;
