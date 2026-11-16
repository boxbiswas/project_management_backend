import mongoose from 'mongoose';
import Comment from '../models/Comment.js';
import Ticket from '../models/Ticket.js';
import Project from '../models/Project.js';

// Check if a user is a member or creator of the project
const isProjectMember = (project, userId) => {
  const creatorId = project.createdBy?._id || project.createdBy;
  if (creatorId && creatorId.toString() === userId.toString()) return true;

  return project.teamMembers.some((m) => {
    const mId = m.userId?._id || m.userId;
    return mId && mId.toString() === userId.toString();
  });
};

// Check if user is project admin or manager
const isProjectAdminOrManager = (project, userId) => {
  const creatorId = project.createdBy?._id || project.createdBy;
  if (creatorId && creatorId.toString() === userId.toString()) return true;

  const member = project.teamMembers.find((m) => {
    const mId = m.userId?._id || m.userId;
    return mId && mId.toString() === userId.toString();
  });

  return member && (member.role === 'admin' || member.role === 'manager');
};

// POST /tickets/:ticketId/comments - Add a new comment to a ticket
export const addComment = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { text } = req.body;
    const currentUserId = req.user.id || req.user.userId;

    // Validate ticket ID format
    if (!ticketId || !mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: 'Valid ticket ID is required' });
    }

    // Validate comment text
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Comment text is required' });
    }

    // Ensure ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Ensure user has access to the ticket's project
    const project = await Project.findById(ticket.projectId);
    if (!project) {
      return res.status(404).json({ message: 'Associated project not found' });
    }
    if (!isProjectMember(project, currentUserId)) {
      return res.status(403).json({ message: 'Access denied: not a member of this project' });
    }

    // Create and save comment in database
    const newComment = await Comment.create({
      ticketId,
      userId: currentUserId,
      text: text.trim(),
    });

    // Populate user profile info for frontend display
    const populatedComment = await Comment.findById(newComment._id).populate(
      'userId',
      'name email'
    );

    return res.status(201).json({
      message: 'Comment added successfully',
      comment: populatedComment,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error adding comment', error: error.message });
  }
};

// GET /tickets/:ticketId/comments - Retrieve all comments for a ticket
export const getCommentsByTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const currentUserId = req.user.id || req.user.userId;

    // Validate ticket ID format
    if (!ticketId || !mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: 'Valid ticket ID is required' });
    }

    // Ensure ticket exists
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Verify project access
    const project = await Project.findById(ticket.projectId);
    if (!project) {
      return res.status(404).json({ message: 'Associated project not found' });
    }
    if (!isProjectMember(project, currentUserId)) {
      return res.status(403).json({ message: 'Access denied: not a member of this project' });
    }

    // Fetch comments in chronological order with user info
    const comments = await Comment.find({ ticketId })
      .populate('userId', 'name email')
      .sort({ createdAt: 1 });

    return res.status(200).json({
      count: comments.length,
      comments,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error fetching comments', error: error.message });
  }
};

// DELETE /tickets/:ticketId/comments/:commentId - Delete a comment
export const deleteComment = async (req, res) => {
  try {
    const { ticketId, commentId } = req.params;
    const currentUserId = req.user.id || req.user.userId;

    // Validate IDs format
    if (!mongoose.Types.ObjectId.isValid(ticketId) || !mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ message: 'Valid ticket ID and comment ID are required' });
    }

    // Ensure comment exists
    const comment = await Comment.findById(commentId);
    if (!comment || comment.ticketId.toString() !== ticketId) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check permissions: comment author or project manager/admin
    const ticket = await Ticket.findById(ticketId);
    const project = await Project.findById(ticket.projectId);
    const isAuthor = comment.userId.toString() === currentUserId.toString();
    const canManage = project && isProjectAdminOrManager(project, currentUserId);

    if (!isAuthor && !canManage) {
      return res.status(403).json({ message: 'Permission denied: cannot delete this comment' });
    }

    await Comment.findByIdAndDelete(commentId);

    return res.status(200).json({
      message: 'Comment deleted successfully',
      commentId,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error deleting comment', error: error.message });
  }
};
