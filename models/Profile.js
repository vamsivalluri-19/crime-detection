const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: String,
  email: String,
  phone: String,
  avatar: String,
  notificationPreferences: {
    emailIncidents: { type: Boolean, default: true },
    smsEmergencies: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: false }
  },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Profile', profileSchema);
