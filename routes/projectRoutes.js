import express from 'express';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  addProjectMember,
  removeProjectMember,
} from '../controllers/projectController.js';
import { getTicketsByProject } from '../controllers/ticketController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Project management endpoints
router.post('/', authenticate, createProject);
router.get('/', authenticate, getProjects);
router.get('/:projectId', authenticate, getProjectById);
router.patch('/:projectId', authenticate, updateProject);
router.delete('/:projectId', authenticate, deleteProject);

// Project member management endpoints
router.post('/:projectId/members', authenticate, addProjectMember);
router.delete('/:projectId/members/:userId', authenticate, removeProjectMember);

// Project tickets listing endpoint
router.get('/:projectId/tickets', authenticate, getTicketsByProject);

export default router;
