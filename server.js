const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Cargar las variables de entorno del archivo .env
dotenv.config();

const app = express();
const port = 3000;

// Middleware para procesar JSON en las peticiones
app.use(express.json());

// Conexión a MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Conectado a MongoDB Atlas'))
.catch(err => console.error('Error al conectar a MongoDB', err));

// Esquema para las clases de gimnasio
const classSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    location: {
        name: {
            type: String,
            required: true
        }
    },
    schedule: {
        startTime: {
            type: String,
            required: true
        }
    },
    maxCapacity: {
        type: Number,
        required: true
    }
});

const GymClass = mongoose.model('GymClass', classSchema);

// Esquema para las reservas
const reservationSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    gymClassId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GymClass',
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    }
});

const Reservation = mongoose.model('Reservation', reservationSchema);

// --- RUTAS DE LA API ---

// Ruta GET para obtener todas las clases
app.get('/api/classes', async (req, res) => {
    try {
        const classes = await GymClass.find();
        res.json(classes);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Ruta POST para crear una nueva clase
app.post('/api/classes', async (req, res) => {
    const { name, location, schedule, maxCapacity } = req.body;
    
    // Verificación básica de datos
    if (!name || !location || !schedule || !maxCapacity) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const newClass = new GymClass({
        name,
        location,
        schedule,
        maxCapacity
    });

    try {
        const savedClass = await newClass.save();
        res.status(201).json(savedClass);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Ruta GET para obtener todas las reservas
app.get('/api/reservations', async (req, res) => {
    try {
        // 'populate' reemplaza el gymClassId con los datos completos de la clase
        const reservations = await Reservation.find().populate('gymClassId');
        res.json(reservations);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Ruta POST para crear una nueva reserva
app.post('/api/reservations', async (req, res) => {
    const { userId, gymClassId } = req.body;
    
    if (!userId || !gymClassId) {
        return res.status(400).json({ error: 'Faltan userId o gymClassId' });
    }

    const newReservation = new Reservation({
        userId,
        gymClassId
    });
    
    try {
        const savedReservation = await newReservation.save();
        res.status(201).json(savedReservation);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Backend de RitmoFit corriendo en http://localhost:${port}`);
});