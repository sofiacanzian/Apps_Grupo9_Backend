const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());

// Conexión a MongoDB
mongoose.connect('mongodb://localhost:27017/ritmofit', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Conectado a MongoDB'))
.catch(err => console.error('Error al conectar a MongoDB', err));

// Esquemas y modelos
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: false },
    otp: { type: String, required: false },
    otpExpires: { type: Date, required: false },
    isVerified: { type: Boolean, default: false },
    name: { type: String },
    lastName: { type: String }, // Nuevo campo
    memberId: { type: String, unique: true, sparse: true }, // Nuevo campo
    birthDate: { type: Date }, // Nuevo campo
    phoneNumber: { type: String },
    address: { type: String },
    photo: { type: String } // Campo de foto opcional
}, { collection: 'users' });
const User = mongoose.model('User', userSchema);

const gymClassSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    maxCapacity: { type: Number, required: true },
    currentCapacity: { type: Number, default: 0 },
    schedule: {
        day: { type: String, required: true },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true }
    },
    location: {
        name: { type: String, required: true }
    },
    professor: { type: String },
    duration: { type: Number } // Duración en minutos
}, { collection: 'gym_classes' });
const GymClass = mongoose.model('GymClass', gymClassSchema);

const reservationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'GymClass', required: true },
    reservationDate: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'cancelled', 'attended'], default: 'active' }
}, { collection: 'reservations' });
const Reservation = mongoose.model('Reservation', reservationSchema);

// Configuración de Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'uadepruebas@gmail.com',
        pass: 'gbdn gquc glch olbv'
    }
});

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Rutas
app.get('/', (req, res) => {
    res.send('API de RitmoFit en funcionamiento!');
});

// Enviar OTP
app.post('/api/auth/send-otp', async (req, res) => {
    const { email } = req.body;
    try {
        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ email });
        }
        user.otp = generateOTP();
        user.otpExpires = new Date(Date.now() + 10 * 60000); // 10 minutos
        await user.save();

        const mailOptions = {
            from: 'uadepruebas@gmail.com',
            to: email,
            subject: 'Código de Verificación para RitmoFit',
            text: `Tu código de verificación es: ${user.otp}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log(error);
                return res.status(500).json({ message: 'Error al enviar el correo' });
            }
            res.status(200).json({ message: 'Código OTP enviado al correo electrónico' });
        });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error });
    }
});

// Confirmar OTP
app.post('/api/auth/confirm-otp', async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({ email, otp, otpExpires: { $gt: new Date() } });
        if (user) {
            user.isVerified = true;
            user.otp = null;
            user.otpExpires = null;
            await user.save();
            
            // CORRECCIÓN: Devolvemos el objeto de usuario completo para que el cliente lo pueda deserializar.
            res.status(200).json({ 
                message: 'Usuario verificado exitosamente', 
                user: {
                    id: user._id,
                    name: user.name || null, // Asegúrate de incluir campos nulos
                    email: user.email,
                    lastName: user.lastName || null,
                    memberId: user.memberId || null,
                    birthDate: user.birthDate || null,
                    profilePhotoUrl: user.photo || null
                }
            });
        } else {
            res.status(400).json({ message: 'Código OTP o correo electrónico incorrecto, o ha expirado' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error });
    }
});

//---
// Rutas de Perfil
//---

// Ruta para obtener el perfil del usuario por su ID
app.get('/api/profile/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const user = await User.findById(userId);
        if (user) {
            // Devolver un objeto de usuario con todos los campos del esquema,
            // asegurando que los campos nulos se incluyan explícitamente.
            const userProfile = {
                id: user._id,
                email: user.email,
                name: user.name || null,
                lastName: user.lastName || null,
                memberId: user.memberId || null,
                birthDate: user.birthDate || null,
                phoneNumber: user.phoneNumber || null,
                address: user.address || null,
                profilePhotoUrl: user.photo || null,
                isVerified: user.isVerified
            };
            res.status(200).json(userProfile);
        } else {
            res.status(404).json({ message: 'Usuario no encontrado' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener el perfil', error });
    }
});

// Ruta para actualizar los datos del perfil del usuario por su ID
app.put('/api/profile/:userId', async (req, res) => {
    const { userId } = req.params;
    const { name, lastName, memberId, birthDate, phoneNumber, address, photo } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        user.name = name ?? user.name;
        user.lastName = lastName ?? user.lastName;
        user.memberId = memberId ?? user.memberId;
        user.birthDate = birthDate ?? user.birthDate;
        user.phoneNumber = phoneNumber ?? user.phoneNumber;
        user.address = address ?? user.address;
        user.photo = photo ?? user.photo;

        await user.save();

        const updatedProfile = {
            id: user._id,
            email: user.email,
            name: user.name || null,
            lastName: user.lastName || null,
            memberId: user.memberId || null,
            birthDate: user.birthDate || null,
            phoneNumber: user.phoneNumber || null,
            address: user.address || null,
            profilePhotoUrl: user.photo || null,
            isVerified: user.isVerified
        };

        // CORRECCIÓN: Devuelve solo el objeto de perfil directamente
        res.status(200).json(updatedProfile); 
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar el perfil.', error: error.message });
    }
});

//---
// Rutas de Clases
//---

// Helper para convertir el día de la semana a español con acentos si es necesario
function getSpanishDay(date) {
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const d = new Date(date);
    return days[d.getDay()];
}

// Ruta para obtener el listado de clases con filtros
app.get('/api/classes', async (req, res) => {
    try {
        const { location, discipline, date } = req.query;
        let filter = {};

        if (location) {
            filter['location.name'] = location;
        }

        if (discipline) {
            filter.name = { $regex: new RegExp(discipline, 'i') }; // Búsqueda insensible a mayúsculas/minúsculas
        }

        if (date) {
            const dayOfWeek = getSpanishDay(date);
            filter['schedule.day'] = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);
        }

        const classes = await GymClass.find(filter);
        res.status(200).json(classes);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener las clases filtradas', error });
    }
});

// Ruta para obtener las sedes y disciplinas disponibles para los filtros
app.get('/api/filters', async (req, res) => {
    try {
        const locations = await GymClass.distinct('location.name');
        const disciplines = await GymClass.distinct('name');
        res.status(200).json({ locations, disciplines });
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener los filtros', error });
    }
});

// Ruta para obtener los detalles de una clase específica
app.get('/api/classes/:classId', async (req, res) => {
    const { classId } = req.params;
    try {
        const gymClass = await GymClass.findById(classId);
        if (gymClass) {
            res.status(200).json(gymClass);
        } else {
            res.status(404).json({ message: 'Clase no encontrada' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener los detalles de la clase', error });
    }
});

//---
// Rutas de Reservas
//---

// Ruta para obtener las reservas de un usuario
app.get('/api/reservations/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const reservations = await Reservation.find({ userId }).populate('classId');
        res.status(200).json(reservations);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener las reservas', error });
    }
});

// Ruta para crear una nueva reserva
app.post('/api/reservations', async (req, res) => {
    const { userId, classId } = req.body;
    try {
        const gymClass = await GymClass.findById(classId);
        if (!gymClass) {
            return res.status(404).json({ message: 'Clase no encontrada.' });
        }

        if (gymClass.currentCapacity >= gymClass.maxCapacity) {
            return res.status(400).json({ message: 'No hay cupo disponible para esta clase.' });
        }

        const newReservation = new Reservation({ userId, classId });
        await newReservation.save();

        gymClass.currentCapacity += 1;
        await gymClass.save();

        res.status(201).json(newReservation);
    } catch (error) {
        res.status(500).json({ message: 'Error al crear la reserva', error });
    }
});

// Ruta para cancelar una reserva
app.post('/api/reservations/cancel/:reservationId', async (req, res) => {
    const { reservationId } = req.params;
    try {
        const reservation = await Reservation.findById(reservationId);
        if (!reservation) {
            return res.status(404).json({ message: 'Reserva no encontrada.' });
        }
        
        if (reservation.status === 'cancelled') {
            return res.status(400).json({ message: 'La reserva ya ha sido cancelada.' });
        }

        reservation.status = 'cancelled';
        await reservation.save();

        const gymClass = await GymClass.findById(reservation.classId);
        if (gymClass) {
            gymClass.currentCapacity -= 1;
            await gymClass.save();
        }

        res.status(200).json({ message: 'Reserva cancelada exitosamente' });
    } catch (error) {
        res.status(500).json({ message: 'Error al cancelar la reserva', error });
    }
});

//---
// Rutas de Historial (Funcionalidad 8)
//---

// Ruta para obtener el historial de asistencias de un usuario
app.get('/api/history/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const history = await Reservation.find({ userId, status: 'attended' }).populate('classId');
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener el historial de asistencias', error });
    }
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});