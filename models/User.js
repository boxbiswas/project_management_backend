import mongoose from 'mongoose';

// User schema definition
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual relationships for reverse population
userSchema.virtual('createdProjects', {
  ref: 'Project',
  localField: '_id',
  foreignField: 'createdBy',
});

userSchema.virtual('assignedTickets', {
  ref: 'Ticket',
  localField: '_id',
  foreignField: 'assigneeId',
});

userSchema.virtual('createdTickets', {
  ref: 'Ticket',
  localField: '_id',
  foreignField: 'createdBy',
});

userSchema.virtual('comments', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'userId',
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
