import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import Project from '../models/Project.js';
import User from '../models/User.js';
import Comment from '../models/Comment.js';

// Helper to check if user is a member or creator of a project
const isProjectMember = (project, userId) => {
  const creatorId = project.createdBy?._id || project.createdBy;
  if (creatorId && creatorId.toString() === userId.toString()) return true;

  return project.teamMembers.some((m) => {
    const mId = m.userId?._id || m.userId;
    return mId && mId.toString() === userId.toString();
  });
};

// Helper to get user's role in a project (admin, manager, developer, viewer)
const getUserRoleInProject = (project, userId) => {
  if (!project || !userId) return null;
  const userIdStr = userId.toString();
  const creatorId = (project.createdBy?._id || project.createdBy).toString();
  if (creatorId === userIdStr) return 'admin';

  const member = project.teamMembers.find((m) => {
    const mId = (m.userId?._id || m.userId).toString();
    return mId === userIdStr;
  });

  return member ? member.role : null;
};

// Helper to check if user can edit tickets (admin, manager, or developer)
const canEditTicket = (project, ticket, userId) => {
  const role = getUserRoleInProject(project, userId);
  if (!role || role === 'viewer') return false;
  return role === 'admin' || role === 'manager' || role === 'developer';
};

// Helper to check if user can delete tickets (admin, manager, or ticket creator)
const canDeleteTicket = (project, ticket, userId) => {
  const userIdStr = userId.toString();
  const role = getUserRoleInProject(project, userId);
  if (!role || role === 'viewer') return false;

  if (role === 'admin' || role === 'manager') return true;

  const ticketCreatorId = (ticket.createdBy?._id || ticket.createdBy).toString();
  return role === 'developer' && ticketCreatorId === userIdStr;
};

// POST /tickets - Create a new ticket
export const createTicket = async (req, res) => {
  try {
    const { title, description, priority = 'medium', status = 'todo', assigneeId = null, projectId } = req.body;
    const currentUserId = req.user.id || req.user.userId;

    // Validate title and project ID presence
    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Ticket title is required' });
    }
    if (!projectId || !mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ message: 'Valid project ID is required' });
    }

    // Validate project existence and user membership
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const userRole = getUserRoleInProject(project, currentUserId);
    if (!userRole || userRole === 'viewer') {
      return res.status(403).json({ message: 'Permission denied: viewers cannot create tickets' });
    }

    // Validate priority and status enum values
    const validPriorities = ['low', 'medium', 'high'];
    const validStatuses = ['todo', 'in_progress', 'done'];

    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ message: `Priority must be one of: ${validPriorities.join(', ')}` });
    }
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    // Validate assignee reference and project membership if specified
    let verifiedAssigneeId = null;
    if (assigneeId) {
      if (!mongoose.Types.ObjectId.isValid(assigneeId)) {
        return res.status(400).json({ message: 'Invalid assignee ID format' });
      }

      const isAssigneeMember = isProjectMember(project, assigneeId);
      if (!isAssigneeMember) {
        return res.status(400).json({ message: 'Assignee must be an existing member of this project' });
      }
      verifiedAssigneeId = assigneeId;
    }

    // Create and save ticket
    const newTicket = await Ticket.create({
      title: title.trim(),
      description: description ? description.trim() : '',
      priority,
      status,
      assigneeId: verifiedAssigneeId,
      projectId,
      createdBy: currentUserId,
    });

    const populatedTicket = await Ticket.findById(newTicket._id)
      .populate('assigneeId', 'name email')
      .populate('createdBy', 'name email')
      .populate('projectId', 'title');

    return res.status(201).json({
      message: 'Ticket created successfully',
      ticket: populatedTicket,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error creating ticket', error: error.message });
  }
};

// GET /tickets - List tickets for the current user across accessible projects
export const getUserTickets = async (req, res) => {
  try {
    const currentUserId = req.user.id || req.user.userId;

    // Find all projects accessible to user
    const userProjects = await Project.find({
      $or: [{ createdBy: currentUserId }, { 'teamMembers.userId': currentUserId }],
    }).select('_id');

    const projectIds = userProjects.map((p) => p._id);

    const filter = { projectId: { $in: projectIds } };
    if (req.query.assignedToMe === 'true') {
      filter.assigneeId = currentUserId;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const tickets = await Ticket.find(filter)
      .populate('assigneeId', 'name email')
      .populate('createdBy', 'name email')
      .populate('projectId', 'title')
      .sort({ updatedAt: -1 });

    return res.status(200).json({ tickets });
  } catch (error) {
    return res.status(500).json({ message: 'Server error fetching tickets', error: error.message });
  }
};

// GET /projects/:projectId/tickets - List all tickets for a specific project with filters & search
export const getTicketsByProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const currentUserId = req.user.id || req.user.userId;

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ message: 'Invalid project ID format' });
    }

    // Verify project existence and membership
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!isProjectMember(project, currentUserId)) {
      return res.status(403).json({ message: 'Access denied: not a member of this project' });
    }

    // Build dynamic query filter with status, priority, assignee, and keyword search
    const filter = { projectId };

    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    }

    if (req.query.priority && req.query.priority !== 'all') {
      filter.priority = req.query.priority;
    }

    if (req.query.assignee && req.query.assignee !== 'all') {
      if (req.query.assignee === 'unassigned') {
        filter.assigneeId = null;
      } else if (mongoose.Types.ObjectId.isValid(req.query.assignee)) {
        filter.assigneeId = req.query.assignee;
      }
    }

    if (req.query.search && req.query.search.trim()) {
      const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      filter.$or = [
        { title: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
      ];
    }

    const tickets = await Ticket.find(filter)
      .populate('assigneeId', 'name email')
      .populate('createdBy', 'name email')
      .sort({ updatedAt: -1 });

    return res.status(200).json({ count: tickets.length, tickets });
  } catch (error) {
    return res.status(500).json({ message: 'Server error fetching tickets', error: error.message });
  }
};

// GET /tickets/:ticketId - Get single ticket details
export const getTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const currentUserId = req.user.id || req.user.userId;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: 'Invalid ticket ID format' });
    }

    const ticket = await Ticket.findById(ticketId)
      .populate('assigneeId', 'name email')
      .populate('createdBy', 'name email')
      .populate('projectId', 'title teamMembers createdBy');

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Verify user belongs to the ticket's project
    if (!ticket.projectId || !isProjectMember(ticket.projectId, currentUserId)) {
      return res.status(403).json({ message: 'Access denied: not a member of this ticket project' });
    }

    return res.status(200).json({ ticket });
  } catch (error) {
    return res.status(500).json({ message: 'Server error fetching ticket', error: error.message });
  }
};

// PATCH /tickets/:ticketId - Update ticket details (title, description, status, priority)
export const updateTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { title, description, priority, status, assigneeId } = req.body;
    const currentUserId = req.user.id || req.user.userId;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: 'Invalid ticket ID format' });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const project = await Project.findById(ticket.projectId);
    if (!project || !isProjectMember(project, currentUserId)) {
      return res.status(403).json({ message: 'Access denied: not a member of this project' });
    }

    // Role-based authorization check
    if (!canEditTicket(project, ticket, currentUserId)) {
      return res.status(403).json({ message: 'Permission denied: viewers cannot edit tickets' });
    }

    // Apply and validate field modifications
    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({ message: 'Ticket title cannot be empty' });
      }
      ticket.title = title.trim();
    }

    if (description !== undefined) {
      ticket.description = description.trim();
    }

    if (priority !== undefined) {
      const validPriorities = ['low', 'medium', 'high'];
      if (!validPriorities.includes(priority)) {
        return res.status(400).json({ message: `Priority must be one of: ${validPriorities.join(', ')}` });
      }
      ticket.priority = priority;
    }

    if (status !== undefined) {
      const validStatuses = ['todo', 'in_progress', 'done'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `Status must be one of: ${validStatuses.join(', ')}` });
      }
      ticket.status = status;
    }

    if (assigneeId !== undefined) {
      if (assigneeId === null || assigneeId === '') {
        ticket.assigneeId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(assigneeId)) {
          return res.status(400).json({ message: 'Invalid assignee ID format' });
        }
        if (!isProjectMember(project, assigneeId)) {
          return res.status(400).json({ message: 'Assignee must be a member of this project' });
        }
        ticket.assigneeId = assigneeId;
      }
    }

    await ticket.save();

    const updatedTicket = await Ticket.findById(ticketId)
      .populate('assigneeId', 'name email')
      .populate('createdBy', 'name email')
      .populate('projectId', 'title');

    return res.status(200).json({
      message: 'Ticket updated successfully',
      ticket: updatedTicket,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error updating ticket', error: error.message });
  }
};

// PATCH /tickets/:ticketId/assignee - Reassign or unassign ticket
export const updateTicketAssignee = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { assigneeId } = req.body;
    const currentUserId = req.user.id || req.user.userId;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: 'Invalid ticket ID format' });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const project = await Project.findById(ticket.projectId);
    if (!project || !isProjectMember(project, currentUserId)) {
      return res.status(403).json({ message: 'Access denied: not a member of this project' });
    }

    // Role-based authorization check
    if (!canEditTicket(project, ticket, currentUserId)) {
      return res.status(403).json({ message: 'Permission denied: viewers cannot edit tickets' });
    }

    // Handle ticket unassignment
    if (!assigneeId) {
      ticket.assigneeId = null;
    } else {
      if (!mongoose.Types.ObjectId.isValid(assigneeId)) {
        return res.status(400).json({ message: 'Invalid assignee ID format' });
      }

      const isAssigneeMember = isProjectMember(project, assigneeId);
      if (!isAssigneeMember) {
        return res.status(400).json({ message: 'Assignee must be an existing member of this project' });
      }
      ticket.assigneeId = assigneeId;
    }

    await ticket.save();

    const updatedTicket = await Ticket.findById(ticketId)
      .populate('assigneeId', 'name email')
      .populate('createdBy', 'name email')
      .populate('projectId', 'title');

    return res.status(200).json({
      message: 'Ticket assignee updated successfully',
      ticket: updatedTicket,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error updating ticket assignee', error: error.message });
  }
};

// DELETE /tickets/:ticketId - Delete ticket
export const deleteTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const currentUserId = req.user.id || req.user.userId;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: 'Invalid ticket ID format' });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const project = await Project.findById(ticket.projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Role-based authorization: admin, manager, or ticket creator
    if (!canDeleteTicket(project, ticket, currentUserId)) {
      return res.status(403).json({
        message: 'Permission denied: only project admins, managers, or the ticket creator can delete this ticket',
      });
    }

    // Cascade delete ticket comments and ticket record
    await Comment.deleteMany({ ticketId });
    await Ticket.findByIdAndDelete(ticketId);

    return res.status(200).json({ message: 'Ticket deleted successfully', ticketId });
  } catch (error) {
    return res.status(500).json({ message: 'Server error deleting ticket', error: error.message });
  }
};
