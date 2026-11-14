import Project from '../models/Project.js';
import User from '../models/User.js';

// Helper to check if user has manager or admin rights on project
const canManageProject = (project, userId) => {
  const creatorId = project.createdBy?._id || project.createdBy;
  if (creatorId && creatorId.toString() === userId.toString()) return true;

  const member = project.teamMembers.find((m) => {
    const mId = m.userId?._id || m.userId;
    return mId && mId.toString() === userId.toString();
  });

  return member && (member.role === 'admin' || member.role === 'manager');
};

// Helper to check if user belongs to project team
const isProjectMember = (project, userId) => {
  const creatorId = project.createdBy?._id || project.createdBy;
  if (creatorId && creatorId.toString() === userId.toString()) return true;

  return project.teamMembers.some((m) => {
    const mId = m.userId?._id || m.userId;
    return mId && mId.toString() === userId.toString();
  });
};

// POST /projects - Create a new project
export const createProject = async (req, res) => {
  try {
    const { title, description } = req.body;
    const userId = req.user.id || req.user.userId;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Project title is required' });
    }

    // Initialize project with creator as admin member
    const newProject = await Project.create({
      title: title.trim(),
      description: description ? description.trim() : '',
      createdBy: userId,
      teamMembers: [{ userId, role: 'admin' }],
    });

    const populatedProject = await Project.findById(newProject._id)
      .populate('createdBy', 'name email')
      .populate('teamMembers.userId', 'name email');

    return res.status(201).json({
      message: 'Project created successfully',
      project: populatedProject,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error creating project', error: error.message });
  }
};

// GET /projects - List all projects accessible to current user
export const getProjects = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;

    const projects = await Project.find({
      $or: [{ createdBy: userId }, { 'teamMembers.userId': userId }],
    })
      .populate('createdBy', 'name email')
      .populate('teamMembers.userId', 'name email')
      .sort({ updatedAt: -1 });

    return res.status(200).json({ projects });
  } catch (error) {
    return res.status(500).json({ message: 'Server error fetching projects', error: error.message });
  }
};

// GET /projects/:projectId - Get single project details
export const getProjectById = async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id || req.user.userId;

    const project = await Project.findById(projectId)
      .populate('createdBy', 'name email')
      .populate('teamMembers.userId', 'name email');

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (!isProjectMember(project, userId)) {
      return res.status(403).json({ message: 'Access denied: not a member of this project' });
    }

    return res.status(200).json({ project });
  } catch (error) {
    return res.status(500).json({ message: 'Server error fetching project', error: error.message });
  }
};

// PATCH /projects/:projectId - Update project title or description
export const updateProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { title, description } = req.body;
    const userId = req.user.id || req.user.userId;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (!canManageProject(project, userId)) {
      return res.status(403).json({ message: 'Permission denied: only admin or manager can edit this project' });
    }

    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({ message: 'Project title cannot be empty' });
      }
      project.title = title.trim();
    }

    if (description !== undefined) {
      project.description = description.trim();
    }

    await project.save();

    const updatedProject = await Project.findById(projectId)
      .populate('createdBy', 'name email')
      .populate('teamMembers.userId', 'name email');

    return res.status(200).json({
      message: 'Project updated successfully',
      project: updatedProject,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error updating project', error: error.message });
  }
};

// DELETE /projects/:projectId - Delete project
export const deleteProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id || req.user.userId;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const creatorId = project.createdBy?._id || project.createdBy;
    const isOwner = creatorId && creatorId.toString() === userId.toString();
    const isAdmin = project.teamMembers.some((m) => {
      const memberId = m.userId?._id || m.userId;
      return memberId && memberId.toString() === userId.toString() && m.role === 'admin';
    });

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Permission denied: only project admin can delete this project' });
    }

    await Project.findByIdAndDelete(projectId);

    return res.status(200).json({ message: 'Project deleted successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error deleting project', error: error.message });
  }
};

// POST /projects/:projectId/members - Add registered user to project team
export const addProjectMember = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { email, userId: targetUserId, role = 'developer' } = req.body;
    const currentUserId = req.user.id || req.user.userId;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (!canManageProject(project, currentUserId)) {
      return res.status(403).json({ message: 'Permission denied: only admin or manager can add members' });
    }

    let targetUser = null;
    if (email) {
      targetUser = await User.findOne({ email: email.trim().toLowerCase() });
    } else if (targetUserId) {
      targetUser = await User.findById(targetUserId);
    }

    if (!targetUser) {
      return res.status(404).json({ message: 'No registered user found with that email' });
    }

    const validRoles = ['admin', 'manager', 'developer', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: `Role must be one of: ${validRoles.join(', ')}` });
    }

    const isAlreadyMember = project.teamMembers.some((m) => {
      const memberId = m.userId?._id || m.userId;
      return memberId && memberId.toString() === targetUser._id.toString();
    });

    if (isAlreadyMember) {
      return res.status(400).json({ message: 'User is already a member of this project' });
    }

    project.teamMembers.push({
      userId: targetUser._id,
      role,
    });
    await project.save();

    const updatedProject = await Project.findById(projectId)
      .populate('createdBy', 'name email')
      .populate('teamMembers.userId', 'name email');

    return res.status(200).json({
      message: 'Member added successfully',
      project: updatedProject,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error adding member', error: error.message });
  }
};

// DELETE /projects/:projectId/members/:userId - Remove member from project
export const removeProjectMember = async (req, res) => {
  try {
    const { projectId, userId: memberIdToRemove } = req.params;
    const currentUserId = req.user.id || req.user.userId;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const isSelfRemoval = currentUserId.toString() === memberIdToRemove.toString();
    if (!isSelfRemoval && !canManageProject(project, currentUserId)) {
      return res.status(403).json({ message: 'Permission denied: cannot remove this member' });
    }

    const creatorId = project.createdBy?._id || project.createdBy;
    if (creatorId && creatorId.toString() === memberIdToRemove.toString()) {
      return res.status(400).json({ message: 'Cannot remove the project creator' });
    }

    const initialCount = project.teamMembers.length;
    project.teamMembers = project.teamMembers.filter((m) => {
      const memberId = m.userId?._id || m.userId;
      return memberId && memberId.toString() !== memberIdToRemove.toString();
    });

    if (project.teamMembers.length === initialCount) {
      return res.status(404).json({ message: 'Member not found in this project' });
    }

    await project.save();

    const updatedProject = await Project.findById(projectId)
      .populate('createdBy', 'name email')
      .populate('teamMembers.userId', 'name email');

    return res.status(200).json({
      message: 'Member removed successfully',
      project: updatedProject,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error removing member', error: error.message });
  }
};
