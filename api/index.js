const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Employee Schema
const employeeSchema = new mongoose.Schema({
  name: String,
  role: String,        // e.g., "Office Boy", "Store Keeper"
  isActive: { type: Boolean, default: true },
  hireDate: { type: Date, default: Date.now },
  fireDate: Date
});
const Employee = mongoose.model('Employee', employeeSchema);

// Attendance Schema
const attendanceSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  date: { type: String, required: true }, // YYYY-MM-DD
  status: { type: String, enum: ['present', 'absent'] },
  timestamp: { type: Date, default: Date.now }
});
const Attendance = mongoose.model('Attendance', attendanceSchema);

// ---------- API Routes ----------
// Get all active employees
app.get('/api/employees', async (req, res) => {
  try {
    const employees = await Employee.find({ isActive: true });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hire new employee
app.post('/api/employees', async (req, res) => {
  try {
    const { name, role } = req.body;
    const employee = new Employee({ name, role });
    await employee.save();
    res.json(employee);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fire employee (soft delete)
app.delete('/api/employees/:id', async (req, res) => {
  try {
    await Employee.findByIdAndUpdate(req.params.id, { isActive: false, fireDate: new Date() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark attendance
app.post('/api/attendance', async (req, res) => {
  try {
    const { employeeId, status } = req.body;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    // Upsert: update if exists for today, else create
    const attendance = await Attendance.findOneAndUpdate(
      { employeeId, date: today },
      { status, timestamp: new Date() },
      { upsert: true, new: true }
    );
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get daily attendance for a specific date (default today)
app.get('/api/attendance/daily', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const attendanceRecords = await Attendance.find({ date }).populate('employeeId', 'name role');
    // Also include employees without attendance (as absent)
    const allEmployees = await Employee.find({ isActive: true });
    const result = allEmployees.map(emp => {
      const record = attendanceRecords.find(r => r.employeeId._id.equals(emp._id));
      return {
        employee: emp,
        status: record ? record.status : 'absent',
        timestamp: record ? record.timestamp : null
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get monthly attendance summary (present days count per employee)
app.get('/api/attendance/monthly', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1; // 1-12
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endDate = `${year}-${month.toString().padStart(2, '0')}-31`; // simplified

    const attendanceRecords = await Attendance.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate },
          status: 'present'
        }
      },
      {
        $group: {
          _id: '$employeeId',
          presentDays: { $sum: 1 }
        }
      }
    ]);

    const employees = await Employee.find({ isActive: true });
    const result = employees.map(emp => {
      const found = attendanceRecords.find(r => r._id.equals(emp._id));
      return {
        employee: emp,
        presentDays: found ? found.presentDays : 0
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// For Vercel, export the Express app
module.exports = app;
