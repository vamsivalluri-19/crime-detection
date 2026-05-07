const mongoose = require('mongoose');

const incidentCommentSchema = new mongoose.Schema({
  incidentId: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  comment: String,
  status: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('IncidentComment', incidentCommentSchema);
