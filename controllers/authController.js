import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Validation regexes
const universalNameRegex = /^[a-zA-Z\u00C0-\u017F]+(?:\s[a-zA-Z\u00C0-\u017F]+)*$/;
const numericDomainRegex = /@[0-9]+\.[a-zA-Z]{2,}$/;
const pureNumericUserRegex = /^[0-9]+@/;
const sequentialSpamRegex = /abcde|bcdef|cdefg|12345|23456|34567/i;

// Token generation and cookie helpers
const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, id: user._id, email: user.email },
    process.env.JWT_SECRET || 'fallback_secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
};

const setAuthCookie = (res, token) => {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
};

// POST /auth/register - Register a new user
export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    // Validate full name constraints
    if (!trimmedName) {
      return res.status(400).json({ message: 'Full name is required' });
    }
    if (trimmedName.length < 2) {
      return res.status(400).json({ message: 'Full name must be at least 2 characters' });
    }
    if (trimmedName.length > 70) {
      return res.status(400).json({ message: 'Full name is too long' });
    }
    if (!universalNameRegex.test(trimmedName)) {
      return res.status(400).json({
        message: 'Name must contain only letters and a single space between names. No numbers or symbols allowed.',
      });
    }
    if (/(.)\1{3,}/.test(trimmedName.replace(/\s/g, ''))) {
      return res.status(400).json({ message: 'Name contains too many repeating characters.' });
    }

    // Validate email constraints and anti-spam rules
    if (!trimmedEmail) {
      return res.status(400).json({ message: 'Email address is required' });
    }
    if (trimmedEmail.length < 5) {
      return res.status(400).json({ message: 'Email is too short' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }
    if (numericDomainRegex.test(trimmedEmail)) {
      return res.status(400).json({ message: 'Purely numeric domains (like 123.com) are not authorised.' });
    }
    if (pureNumericUserRegex.test(trimmedEmail)) {
      return res.status(400).json({ message: 'Usernames consisting entirely of numbers are not authorised.' });
    }
    if (sequentialSpamRegex.test(trimmedEmail.split('@')[0])) {
      return res.status(400).json({ message: 'Sequential or automated email patterns are not allowed.' });
    }

    // Validate password
    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check for duplicate user
    const existingUser = await User.findOne({ email: trimmedEmail });
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    // Hash password and persist user
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const newUser = await User.create({
      name: trimmedName,
      email: trimmedEmail,
      passwordHash,
    });

    return res.status(201).json({
      message: 'User registered successfully. Please log in.',
      user: {
        id: newUser._id,
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error during registration', error: error.message });
  }
};

// POST /auth/login - Authenticate user credentials
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email address is required' });
    }
    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Verify user exists and password matches
    const user = await User.findOne({ email: trimmedEmail });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(user);
    setAuthCookie(res, token);

    return res.status(200).json({
      message: 'Logged in successfully',
      token,
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error during login', error: error.message });
  }
};

// POST /auth/logout - Clear session cookie
export const logout = async (req, res) => {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Server error during logout', error: error.message });
  }
};

// GET /auth/me - Retrieve current user profile
export const getMe = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    const user = await User.findById(userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error fetching user profile', error: error.message });
  }
};
