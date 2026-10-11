import mongoose from 'mongoose';

const { Schema } = mongoose;

const STATUSES = ['pending_review', 'needs_clarification', 'approved', 'rejected'];

const HistorySchema = new Schema(
  {
    type: { type: String, enum: ['submitted', 'ai_review', 'decision', 'override', 'clarification_response'], required: true },
    at: { type: Date, default: Date.now },
    actor: { type: String, default: 'system' },
    action: String, // approve | reject | request_clarification (for decisions)
    note: String,
    details: Schema.Types.Mixed,
  },
  { _id: false },
);

const ClarificationSchema = new Schema(
  {
    message: String,
    questions: [String],
    requestedBy: String,
    requestedAt: { type: Date, default: Date.now },
    response: String,
    respondedBy: String,
    respondedAt: Date,
  },
  { _id: true },
);

const ClaimSchema = new Schema(
  {
    // Claim fields as submitted. amount and receiptAvailable stay Mixed so invalid
    // input is preserved and reported by validation instead of being coerced away.
    claimant: String,
    date: String, // YYYY-MM-DD
    category: String,
    amount: Schema.Types.Mixed,
    currency: String,
    description: String,
    receiptAvailable: Schema.Types.Mixed,

    status: { type: String, enum: STATUSES, default: 'pending_review', index: true },
    effectiveCategory: String,
    amountUSD: Number,
    categoryOverride: {
      category: String,
      reason: String,
      by: String,
      at: Date,
    },
    review: Schema.Types.Mixed, // latest review output (see services/review.js)
    reviews: [Schema.Types.Mixed], // every review run, for the full history
    clarifications: [ClarificationSchema],
    history: [HistorySchema],
  },
  { timestamps: true },
);

ClaimSchema.index({ claimant: 1, date: 1 });

export const Claim = mongoose.models.Claim || mongoose.model('Claim', ClaimSchema);
