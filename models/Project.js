import mongoose from 'mongoose';

// Project team member subdocument schema
const teamMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required for team member'],
    },
    role: {
      type: String,
      enum: {
        values: ['admin', 'manager', 'developer', 'viewer'],
        message: '{VALUE} is not a valid project role',
      },
      default: 'developer',
      required: true,
    },
  },
  { _id: false }
);

// Project schema definition
const projectSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Project title is required'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Project creator is required'],
    },
    teamMembers: [teamMemberSchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes specified in plan
projectSchema.index({ createdBy: 1 });
projectSchema.index({ 'teamMembers.userId': 1 });

// Two-way virtual relationship to query tickets belonging to this project
projectSchema.virtual('tickets', {
  ref: 'Ticket',
  localField: '_id',
  foreignField: 'projectId',
});

const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);

export default Project;
