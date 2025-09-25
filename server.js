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
        let reservations = await Reservation.find({ userId }).populate('classId');
        // Actualizar estado a 'expired' si corresponde (no asistió y ya pasó el horario)
        const now = new Date();
        const toUpdate = [];
        for (const r of reservations) {
            try {
                if (r.status === 'active' && r.classId && r.classId.schedule) {
                    const baseDate = r.classDate || now;
                    const [eh,em] = (r.classId.schedule.endTime || r.classId.schedule.startTime || '00:00').split(':').map(Number);
                    const endDT = new Date(baseDate);
                    endDT.setHours(eh||0, em||0, 0, 0);
                    if (endDT < now) {
                        r.status = 'expired';
                        
                        await r.save();
                        // liberar el cupo si quedó como ocupado
                        const gymClass = await GymClass.findById(r.classId._id);
                        if (gymClass && (gymClass.currentCapacity||0) > 0) {
                            gymClass.currentCapacity -= 1;
                            await gymClass.save();
                        }
                    }
                }
            } catch(e){}
        }
        // Por defecto devolvemos próximas (activas y futuras) y canceladas/expiradas también si el cliente las muestra
        res.status(200).json(reservations);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener las reservas', error });
    }
});
    
;

// Ruta para crear una nueva reserva

app.post('/api/reservations', async (req, res) => {
    let { userId, classId, gymClassId } = req.body;
    try {
        // Aceptar tanto classId como gymClassId desde el cliente
        classId = classId || gymClassId;
        if (!userId || !classId) {
            return res.status(400).json({ message: 'userId y classId son requeridos.' });
        }
        const gymClass = await GymClass.findById(classId);
        if (!gymClass) {
            return res.status(404).json({ message: 'Clase no encontrada.' });
        }

        // Validación de cupo
        if (gymClass.currentCapacity >= gymClass.maxCapacity) {
            return res.status(400).json({ message: 'No hay cupo disponible para esta clase.' });
        }

        // Calcular la próxima fecha (classDate) para el día de la clase
        const daysMap = { 'Lunes':1,'Martes':2,'Miércoles':3,'Miercoles':3,'Jueves':4,'Viernes':5,'Sábado':6,'Sabado':6,'Domingo':0 };
        const today = new Date();
        const targetDow = daysMap[gymClass.schedule.day] ?? null;
        let classDate = null;
        if (targetDow !== null) {
            const tmp = new Date(today);
            // set to next occurrence (including today if same dow and start time later)

            const todayDow = tmp.getDay(); // 0 Sunday..6 Saturday
            // map Monday=1..Sunday=0 as per above; convert to JS dow for comparison
            // We already mapped Domingo to 0
            let delta = (targetDow - todayDow);
            if (delta < 0) delta += 7;
            classDate = new Date(tmp.getFullYear(), tmp.getMonth(), tmp.getDate() + delta);
        }
        // Combinar classDate con horario de inicio y fin
        function parseTimeToDate(baseDate, timeStr) {
            const [h,m] = (timeStr || '00:00').split(':').map(Number);
            const d = new Date(baseDate);
            d.setHours(h||0, m||0, 0, 0);
            return d;
        }
        const startDateTime = parseTimeToDate(classDate || today, gymClass.schedule.startTime);
        const endDateTime = parseTimeToDate(classDate || today, gymClass.schedule.endTime || gymClass.schedule.startTime);

        // Validación: no permitir reservar en el pasado
        if (endDateTime < new Date()) {
            return res.status(400).json({ message: 'La clase ya ocurrió. No es posible reservar.' });
        }

        // Validación: evitar doble reserva del mismo turno
        const existingSame = await Reservation.findOne({ userId, classId, status: { $in: ['active'] } });
        if (existingSame) {
            return res.status(400).json({ message: 'Ya tienes una reserva activa para esta clase.' });
        }

        // Validación: evitar solapamiento con otras reservas activas
        const userActive = await Reservation.find({ userId, status: 'active' }).populate('classId');
        const overlaps = userActive.some(r => {
            const c = r.classId;
            if (!c) return false;
            // Check same day of week
            if (c.schedule?.day !== gymClass.schedule?.day) return false;
            const rStart = parseTimeToDate(startDateTime, c.schedule.startTime);
            const rEnd = parseTimeToDate(startDateTime, c.schedule.endTime || c.schedule.startTime);
            return (startDateTime < rEnd && endDateTime > rStart);
        });
        if (overlaps) {
            return res.status(400).json({ message: 'Tienes otra reserva que se superpone en el mismo horario.' });
        }

        const newReservation = new Reservation({ userId, classId, classDate: startDateTime });
        await newReservation.save();

        gymClass.currentCapacity = (gymClass.currentCapacity || 0) + 1;
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