// seed_classes.js
const mongoose = require('mongoose');

const gymClassSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  maxCapacity: { type: Number, required: true },
  currentCapacity: { type: Number, default: 0 },
  discipline: { type: String },
  classDate: { type: Date },
  schedule: {
    day: { type: String, required: true },          // usar español: lunes, martes, ...
    startTime: { type: String, required: true },     // "HH:MM"
    endTime: { type: String, required: true }        // "HH:MM"
  },
  location: {
    name: { type: String, required: true }
  },
  professor: { type: String },
  duration: { type: Number }
}, { collection: 'gym_classes' });

const GymClass = mongoose.model('GymClass', gymClassSchema);

async function run() {
  await mongoose.connect('mongodb://localhost:27017/ritmofit', {
    useNewUrlParser: true, useUnifiedTopology: true
  });

  await GymClass.deleteMany({}); // opcional: limpia la colección

  const docs = [
    {
      name: 'Funcional Ritmo AM',
      description: 'Circuito de fuerza y resistencia.',
      maxCapacity: 20,
      discipline: 'Funcional',
      schedule: { day: 'lunes', startTime: '08:00', endTime: '09:00' },
      location: { name: 'Sede Centro' },
      professor: 'Laura Pérez',
      duration: 60
    },
    {
      name: 'Yoga Flow',
      description: 'Vinyasa suave para movilidad.',
      maxCapacity: 18,
      discipline: 'Yoga',
      schedule: { day: 'martes', startTime: '19:00', endTime: '20:00' },
      location: { name: 'Sede Norte' },
      professor: 'Mariana Díaz',
      duration: 60
    },
    {
      name: 'HIIT Mediodía',
      description: 'Alta intensidad, intervalos cortos.',
      maxCapacity: 16,
      discipline: 'HIIT',
      schedule: { day: 'miércoles', startTime: '12:30', endTime: '13:15' },
      location: { name: 'Sede Centro' },
      professor: 'Diego López',
      duration: 45
    },
    {
      name: 'Ciclismo Indoor',
      description: 'Spinning con trabajo aeróbico.',
      maxCapacity: 22,
      discipline: 'Spinning',
      schedule: { day: 'jueves', startTime: '18:00', endTime: '19:00' },
      location: { name: 'Sede Sur' },
      professor: 'Sofía Ramos',
      duration: 60
    },
    {
      name: 'Box Fitness',
      description: 'Golpes técnicos y acondicionamiento.',
      maxCapacity: 14,
      discipline: 'Box',
      schedule: { day: 'viernes', startTime: '20:00', endTime: '21:00' },
      location: { name: 'Sede Norte' },
      professor: 'Martín Ferreyra',
      duration: 60
    }
  ];

  await GymClass.insertMany(docs);
  console.log('Clases creadas:', docs.length);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
