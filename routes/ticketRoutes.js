import express from 'express';
import {
  createTicket,
  getTicketById,
  updateTicket,
  updateTicketAssignee,
  deleteTicket,
} from '../controllers/ticketController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Ticket management routes
router.post('/', authenticate, createTicket);
router.get('/:ticketId', authenticate, getTicketById);
router.patch('/:ticketId', authenticate, updateTicket);
router.patch('/:ticketId/assignee', authenticate, updateTicketAssignee);
router.delete('/:ticketId', authenticate, deleteTicket);

export default router;
