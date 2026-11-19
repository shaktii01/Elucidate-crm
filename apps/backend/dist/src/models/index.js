import mongoose, { Schema } from 'mongoose';
const userSchema = new Schema({
    name: { type: String, required: true, trim: true },
    employeeId: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['ADMIN', 'SALESPERSON'], default: 'SALESPERSON' },
    active: { type: Boolean, default: true },
}, { timestamps: true });
const remarkSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, message: { type: String, required: true }, createdAt: { type: Date, default: Date.now } });
const activitySchema = new Schema({ type: { type: String, required: true }, actor: { type: Schema.Types.ObjectId, ref: 'User' }, message: String, from: Schema.Types.ObjectId, to: Schema.Types.ObjectId, fromStatus: String, toStatus: String, createdAt: { type: Date, default: Date.now } });
const ownershipSchema = new Schema({ from: Schema.Types.ObjectId, to: Schema.Types.ObjectId, type: String, reason: String, actor: Schema.Types.ObjectId, createdAt: { type: Date, default: Date.now } });
const leadSchema = new Schema({
    name: { type: String, trim: true, default: 'New Client' },
    phone: { type: String, required: true },
    normalizedPhone: { type: String, required: true, index: true },
    isDuplicate: { type: Boolean, default: false, index: true },
    status: { type: String, enum: ['NEW', 'HOT', 'WARM', 'COLD', 'NOT_CONNECTED', 'NOT_INTERESTED', 'JUNK'], default: 'NEW', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    statusChangedAt: { type: Date, default: Date.now }, lastQualifyingActivityAt: Date,
    claimEligibleAt: Date, claimPoolEnteredAt: Date, claimedBy: Schema.Types.ObjectId, claimedAt: Date,
    isClaimable: { type: Boolean, default: false, index: true }, doNotContact: { type: Boolean, default: false },
    junkReason: String, customerDetails: Schema.Types.Mixed, followUpAt: Date, followUpNotifiedAt: Date, remarks: [remarkSchema], activities: [activitySchema],
    ownershipHistory: [ownershipSchema],
}, { timestamps: true });
leadSchema.index({ assignedTo: 1, status: 1, updatedAt: -1 });
leadSchema.index({ isClaimable: 1, claimEligibleAt: 1, status: 1 });
leadSchema.index({ 'activities.createdAt': -1 });
const quotationSchema = new Schema({
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    customer: { type: Schema.Types.Mixed, required: true }, number: String,
    date: { type: Date, default: Date.now }, amount: { type: Number, required: true },
    status: { type: String, enum: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'], default: 'DRAFT', index: true },
    createdBy: Schema.Types.ObjectId,
}, { timestamps: true });
quotationSchema.index({ leadId: 1, status: 1 });
const refreshSessionSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, tokenHash: { type: String, required: true, unique: true }, expiresAt: { type: Date, required: true, expires: 0 } }, { timestamps: true });
const notificationSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, message: String, type: String, leadId: Schema.Types.ObjectId, readAt: Date }, { timestamps: true });
const pushSubscriptionSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, endpoint: { type: String, required: true, unique: true }, expirationTime: { type: Number, default: null }, keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } } }, { timestamps: true });
const attendanceSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, date: { type: Date, required: true }, status: { type: String, enum: ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE'], required: true }, checkIn: { type: String, default: '' }, checkOut: { type: String, default: '' }, checkInAt: Date, checkOutAt: Date, note: { type: String, default: '' }, markedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true } }, { timestamps: true });
attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });
export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
export const Lead = mongoose.models.Lead ?? mongoose.model('Lead', leadSchema);
export const Quotation = mongoose.models.Quotation ?? mongoose.model('Quotation', quotationSchema);
export const RefreshSession = mongoose.models.RefreshSession ?? mongoose.model('RefreshSession', refreshSessionSchema);
export const Notification = mongoose.models.Notification ?? mongoose.model('Notification', notificationSchema);
export const PushSubscription = mongoose.models.PushSubscription ?? mongoose.model('PushSubscription', pushSubscriptionSchema);
export const Attendance = mongoose.models.Attendance ?? mongoose.model('Attendance', attendanceSchema);
