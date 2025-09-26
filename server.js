const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const port = 3000;

// CLAVE SECRETA PARA FIRMAR LOS TOKENS JWT
// ¡IMPORTANTE! En producción, debe estar en una variable de entorno.
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura_aqui'; 

app.use(express.json());
app.use(cors());

// Conexión a MongoDB
mongoose.connect('mongodb://localhost:27017/ritmofit', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Conectado a MongoDB'))
.catch(err => console.error('Error al conectar a MongoDB', err));

// =========================================================================
// ESQUEMAS Y MODELOS
// =========================================================================

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: false },
    otp: { type: String, required: false },
    otpExpires: { type: Date, required: false },
    isVerified: { type: Boolean, default: false },
    name: { type: String },
    lastName: { type: String },
    // memberId: Se hace único con sparse: true para permitir nulos
    memberId: { 
        type: String, unique: true, sparse: true 
    },
    birthDate: { type: Date },
    phoneNumber: { type: String },
    address: { type: String },
    photo: { type: String },
    role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { collection: 'users' });
const User = mongoose.model('User', userSchema);

const gymClassSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    maxCapacity: { type: Number, required: true },
    currentCapacity: { type: Number, default: 0 },
    discipline: { type: String }, 
    classDate: { type: Date },
    schedule: {
        day: { type: String, required: true },
        startTime: { type: String, required: true },
        endTime: { type: String, required: true }
    },
    location: {
        name: { type: String, required: true }
    },
    professor: { type: String },
    duration: { type: Number }
}, { collection: 'gym_classes' });
const GymClass = mongoose.model('GymClass', gymClassSchema);

const reservationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'GymClass', required: true },
    reservationDate: { type: Date, default: Date.now },
    classDate: { type: Date, required: true }, // Fecha y hora de inicio de la clase reservada
    status: { type: String, enum: ['active', 'cancelled', 'attended', 'expired'], default: 'active' }
}, { collection: 'reservations' });
const Reservation = mongoose.model('Reservation', reservationSchema);

const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
}, { collection: 'counters' });
const Counter = mongoose.model('Counter', counterSchema);

// =========================================================================
// MIDDLEWARE DE AUTENTICACIÓN Y AUTORIZACIÓN (JWT)
// =========================================================================

/**
 * Middleware para verificar el token JWT en la cabecera "Authorization".
 */
const auth = (req, res, next) => {
    try {
        // Extrae el token, eliminando "Bearer "
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'Authentication required. No token provided.' });
        }
        // Verifica el token
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Adjunta el payload (userId, email, role) al request
        next();
    } catch (e) {
        // Token inválido o expirado
        res.status(401).json({ error: 'Invalid or expired token. Please re-authenticate.' });
    }
};

/**
 * Middleware para restringir el acceso solo a administradores.
 */
const adminAuth = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Authorization required. Not an administrator.' });
    }
};

// =========================================================================
// HELPERS GENERALES
// =========================================================================

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

async function getNextSequenceValue(sequenceName) {
    const counter = await Counter.findByIdAndUpdate(
        { _id: sequenceName },
        { $inc: { seq: 1 } },
        { new: true, upsert: true } 
    );
    return counter.seq.toString().padStart(4, '0');
}

/**
 * Función para calcular la próxima fecha de la clase (día de la semana).
 * Devuelve un objeto Date sin hora o null.
 */
function calculateNextClassDate(dayOfWeek, startTime) {
    const normalizedDay = dayOfWeek.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const daysMap = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6 };
    const targetDow = daysMap[normalizedDay] ?? null;

    if (targetDow === null) {
        console.warn(`Día de la semana no reconocido: ${dayOfWeek}`);
        return null;
    }

    const today = new Date();
    let classDate = new Date(today); 
    
    const todayDow = today.getDay();
    let delta = (targetDow - todayDow);
    if (delta < 0) delta += 7;
    
    classDate.setDate(classDate.getDate() + delta);
    
    // Si la clase es hoy, verificar la hora
    if (delta === 0) {
        const [h, m] = (startTime || '00:00').split(':').map(Number);
        const currentHour = today.getHours();
        const currentMinute = today.getMinutes();

        // Si la hora de la clase ya pasó hoy, programarla para la próxima semana
        if (h < currentHour || (h === currentHour && m <= currentMinute)) {
            classDate.setDate(classDate.getDate() + 7);
        }
    }

    // Devolver la fecha sin la hora actual
    classDate.setHours(0, 0, 0, 0); 
    return classDate;
}

// Helper para parsear la hora y combinarla con una fecha base
function parseTimeToDate(baseDate, timeStr) {
    const [h,m] = (timeStr || '00:00').split(':').map(Number);
    const d = new Date(baseDate);
    d.setHours(h||0, m||0, 0, 0);
    return d;
}

// Helper para convertir el día de la semana a español y normalizar
function getSpanishDay(dateString) {
    const d = new Date(dateString);
    const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return days[d.getDay()].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Rutas base
app.get('/', (req, res) => {
    res.send('API de RitmoFit en funcionamiento!');
});

// =========================================================================
// RUTAS DE AUTENTICACIÓN
// =========================================================================

// 1. Registro: /api/auth/register-send-otp
app.post('/api/auth/register-send-otp', async (req, res) => {
    const email = req.body.email ? req.body.email.trim() : null;
    const password = req.body.password ? req.body.password.trim() : null;
    
    try {
        let user = await User.findOne({ email });
        if (user && user.isVerified) {
            return res.status(400).json({ message: 'El usuario ya existe y está verificado.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const otpCode = generateOTP();

        if (!user) {
            const newMemberId = await getNextSequenceValue('memberId'); 
            user = new User({ 
                email, 
                password: hashedPassword, 
                otp: otpCode, 
                otpExpires: new Date(Date.now() + 10 * 60000), 
                isVerified: false,
                memberId: newMemberId,
                role: 'user'
            });
        } else {
            user.password = hashedPassword;
            user.otp = otpCode;
            user.otpExpires = new Date(Date.now() + 10 * 60000); 
            user.isVerified = false;
        }

        await user.save();

        const mailOptions = {
            from: 'uadepruebas@gmail.com',
            to: email,
            subject: 'Código de Verificación de Registro para RitmoFit',
            text: `Tu código de verificación para completar tu registro es: ${otpCode}`
        };
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(error);
                return res.status(500).json({ message: 'Error al enviar el correo de registro' });
            }
            res.status(200).json({ message: 'Código OTP enviado al correo electrónico para registro.' });
        });
    } catch (error) {
        if (error.code === 11000) { 
            return res.status(409).json({ message: 'El correo electrónico ya está registrado.' });
        }
        res.status(500).json({ message: 'Error en el servidor durante el registro', error });
    }
});

// 2. Login: /api/auth/login-send-otp
app.post('/api/auth/login-send-otp', async (req, res) => {
    const email = req.body.email ? req.body.email.trim() : null;
    const password = req.body.password ? req.body.password.trim() : null;

    try {
        const user = await User.findOne({ email });
        if (!user || !user.password || !user.isVerified) { 
            return res.status(401).json({ message: 'Credenciales inválidas o usuario no verificado.' });
        }
       
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciales inválidas.' });
        }
        
        user.otp = generateOTP();
        user.otpExpires = new Date(Date.now() + 10 * 60000); 
        await user.save();

        const mailOptions = {
            from: 'uadepruebas@gmail.com',
            to: email,
            subject: 'Código de Verificación de Inicio de Sesión para RitmoFit',
            text: `Tu código de verificación para iniciar sesión es: ${user.otp}`
        };
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(error);
                return res.status(500).json({ message: 'Error al enviar el correo de login' });
            }
            res.status(200).json({ message: 'Código OTP enviado al correo electrónico para inicio de sesión.' });
        });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor durante el login', error });
    }
});


// 3. Confirmar OTP y Login: /api/auth/verify-otp-and-login
app.post('/api/auth/verify-otp-and-login', async (req, res) => {
    const email = req.body.email ? req.body.email.trim() : null;
    const otp = req.body.otp ? req.body.otp.trim() : null;

    try {
        const user = await User.findOne({ email, otp, otpExpires: { $gt: new Date() } });
        if (user) {
            user.isVerified = true;
            user.otp = null;
            user.otpExpires = null;
            await user.save();
            
            // Añadir el rol al payload del JWT
            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role }, 
                JWT_SECRET, 
                { expiresIn: '1h' } 
            );
            
            const userObject = user.toObject();

            // Devolver el token a nivel raíz
            res.status(200).json({ 
                message: 'Verificación exitosa. Sesión iniciada.', 
                token: token, 
                user: {
                    id: userObject._id,
                    name: userObject.name || null, 
                    email: userObject.email,
                    lastName: userObject.lastName || null,
                    memberId: userObject.memberId || null,
                    birthDate: userObject.birthDate || null,
                    phoneNumber: userObject.phoneNumber || null,
                    address: userObject.address || null,
                    profilePhotoUrl: userObject.photo || null,
                    role: userObject.role 
                }
            });
        } else {
            res.status(400).json({ message: 'Código OTP o correo electrónico incorrecto, o ha expirado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor durante la verificación', error });
    }
});


// 4. Solicitud de Contraseña: /api/auth/request-password-reset
app.post('/api/auth/request-password-reset', async (req, res) => {
    const email = req.body.email ? req.body.email.trim() : null;
    
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }
        
        user.otp = generateOTP();
        user.otpExpires = new Date(Date.now() + 10 * 60000); 
        await user.save();

        const mailOptions = {
            from: 'uadepruebas@gmail.com',
            to: email,
            subject: 'Código de Recuperación de Contraseña para RitmoFit',
            text: `Tu código de verificación para restablecer tu contraseña es: ${user.otp}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(error);
                return res.status(500).json({ message: 'Error al enviar el correo de recuperación' });
            }
            res.status(200).json({ message: 'Código OTP de recuperación enviado al correo electrónico.' });
        });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor durante la solicitud de recuperación', error });
    }
});


// 5. Restablecer Contraseña: /api/auth/reset-password
app.post('/api/auth/reset-password', async (req, res) => {
    const email = req.body.email ? req.body.email.trim() : null;
    const otp = req.body.otp ? req.body.otp.trim() : null;
    const newPassword = req.body.newPassword ? req.body.newPassword.trim() : null;

    try {
        const user = await User.findOne({ email, otp, otpExpires: { $gt: new Date() } });
        if (!user) {
            return res.status(400).json({ message: 'Código OTP, correo electrónico incorrecto, o ha expirado.' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        user.otp = null;
        user.otpExpires = null;
        await user.save();
        
        res.status(200).json({ message: 'Contraseña restablecida exitosamente.' });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor al restablecer contraseña', error });
    }
});

// =========================================================================
// RUTAS DE PERFIL (PROTEGIDAS)
// =========================================================================

// Ruta para obtener el perfil del usuario por su ID
app.get('/api/profile/:userId', auth, async (req, res) => {
    const { userId } = req.params;
    
    if (req.user.userId !== userId) {
        return res.status(403).json({ message: 'Acceso denegado: Token no corresponde al usuario solicitado.' });
    }
    
    try {
        const user = await User.findById(userId);
        if (user) {
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
                isVerified: user.isVerified,
                role: user.role
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
app.put('/api/profile/:userId', auth, async (req, res) => {
    const { userId } = req.params;
    const { name, lastName, birthDate, phoneNumber, address, photo } = req.body;
    
    if (req.user.userId !== userId) {
        return res.status(403).json({ message: 'Acceso denegado: Token no corresponde al usuario solicitado.' });
    }
    
    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        user.name = name ?? user.name;
        user.lastName = lastName ?? user.lastName;
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
            isVerified: user.isVerified,
            role: user.role
        };
        res.status(200).json(updatedProfile); 
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar el perfil.', error: error.message });
    }
});


// =========================================================================
// RUTAS DE CLASES (PROTEGIDAS)
// =========================================================================

// Ruta para obtener el listado de clases con filtros
app.get('/api/classes', auth, async (req, res) => {
    try {
        const { location, discipline, date } = req.query;
        let filter = {};

        if (location) {
            filter['location.name'] = location;
        }

        if (discipline) {
            filter.name = { $regex: new RegExp(discipline, 'i') };
        }

        let classes = await GymClass.find(filter).lean();

        let targetDayOfWeek = null;
        if (date) {
            targetDayOfWeek = getSpanishDay(date); 
        }
        
        classes = classes.map(cls => {
            const calculatedDate = calculateNextClassDate(cls.schedule.day, cls.schedule.startTime);
            return {
                id: cls._id.toString(), 
                name: cls.name,
                description: cls.description || null,
                maxCapacity: cls.maxCapacity,
                currentCapacity: cls.currentCapacity,
                schedule: cls.schedule,
                location: cls.location,
                discipline: cls.discipline || cls.name,
                professor: cls.professor || null,  
                duration: cls.duration || null,    
                classDate: calculatedDate ? calculatedDate.toISOString().split('T')[0] : null, 
            };
        }).filter(cls => {
            // Aplicar el filtro por día de la semana si existe
            if (targetDayOfWeek) {
                const classDay = cls.schedule.day.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return classDay === targetDayOfWeek;
            }
            return true;
        });

        res.status(200).json(classes);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener las clases filtradas', error });
    }
});

// Ruta para obtener los detalles de una clase específica 
app.get('/api/classes/:classId', auth, async (req, res) => {
    const { classId } = req.params;
    try {
        const gymClass = await GymClass.findById(classId).lean();
        if (gymClass) {
            const calculatedDate = calculateNextClassDate(gymClass.schedule.day, gymClass.schedule.startTime);
            const formattedClass = {
                id: gymClass._id.toString(),
                ...gymClass,
                discipline: gymClass.discipline || gymClass.name,
                professor: gymClass.professor || null,
                duration: gymClass.duration || null,
                classDate: calculatedDate ? calculatedDate.toISOString().split('T')[0] : null,
            };
            res.status(200).json(formattedClass);
        } else {
            res.status(404).json({ message: 'Clase no encontrada' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener los detalles de la clase', error });
    }
});

// Ruta para obtener las sedes y disciplinas disponibles para los filtros 
app.get('/api/filters', auth, async (req, res) => {
    try {
        const locations = await GymClass.distinct('location.name');
        const disciplines = await GymClass.distinct('discipline') || await GymClass.distinct('name');
        res.status(200).json({ locations, disciplines });
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener los filtros', error });
    }
});


// 🚨 RUTAS DE ADMINISTRACIÓN DE CLASES (Solo Admin) 🚨

// Ruta para crear una nueva clase (Solo Admin)
app.post('/api/classes', auth, adminAuth, async (req, res) => {
    try {
        const newClass = new GymClass(req.body);
        await newClass.save();
        res.status(201).json(newClass);
    } catch (error) {
        console.error('Error al crear la clase:', error);
        res.status(500).json({ message: 'Error al crear la clase', error: error.message });
    }
});

// Ruta para actualizar una clase existente (Solo Admin)
app.put('/api/classes/:classId', auth, adminAuth, async (req, res) => {
    const { classId } = req.params;
    try {
        const updatedClass = await GymClass.findByIdAndUpdate(classId, req.body, { new: true, runValidators: true });
        
        if (!updatedClass) {
            return res.status(404).json({ message: 'Clase no encontrada.' });
        }
        
        res.status(200).json(updatedClass);
    } catch (error) {
        console.error('Error al actualizar la clase:', error);
        res.status(500).json({ message: 'Error al actualizar la clase', error: error.message });
    }
});

// Ruta para eliminar una clase (Solo Admin)
app.delete('/api/classes/:classId', auth, adminAuth, async (req, res) => {
    const { classId } = req.params;
    try {
        const result = await GymClass.findByIdAndDelete(classId);
        
        if (!result) {
            return res.status(404).json({ message: 'Clase no encontrada.' });
        }

        // Cancelar todas las reservas asociadas a esta clase
        await Reservation.updateMany({ classId: classId, status: 'active' }, { status: 'cancelled' });

        res.status(200).json({ message: 'Clase eliminada exitosamente y reservas canceladas.' });
    } catch (error) {
        console.error('Error al eliminar la clase:', error);
        res.status(500).json({ message: 'Error al eliminar la clase', error: error.message });
    }
});

// =========================================================================
// RUTAS DE RESERVAS (PROTEGIDAS)
// =========================================================================

// Ruta para obtener las reservas ACTIVAS de un usuario (Mis Reservas)
app.get('/api/reservations/:userId', auth, async (req, res) => {
    const { userId } = req.params;
    
    if (req.user.userId !== userId) {
        return res.status(403).json({ message: 'Acceso denegado.' });
    }

    try {
        let reservations = await Reservation.find({ userId, status: 'active' }).populate('classId');
        
        const now = new Date();
        const promises = [];

        // Lógica de expiración (solo para las activas)
        for (const r of reservations) {
            if (r.status === 'active' && r.classId && r.classDate) {
                // Si la hora de fin no existe, usamos la de inicio para el cálculo
                const endDateTime = parseTimeToDate(r.classDate, r.classId.schedule.endTime || r.classId.schedule.startTime);

                if (endDateTime < now) {
                    r.status = 'expired';
                    promises.push(r.save());
                    
                    // Liberar el cupo
                    promises.push(GymClass.findByIdAndUpdate(
                        r.classId._id,
                        { $inc: { currentCapacity: -1 } },
                        { new: true }
                    ));
                }
            }
        }
        await Promise.all(promises);

        // Volver a obtener la lista solo con activas, excluyendo las que expiraron en este ciclo
        reservations = await Reservation.find({ userId, status: 'active' }).populate('classId');
        res.status(200).json(reservations);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener las reservas', error });
    }
});


// Ruta para crear una nueva reserva
app.post('/api/reservations', auth, async (req, res) => {
    let { userId, classId, gymClassId } = req.body;
    
    if (req.user.userId !== userId) {
        return res.status(403).json({ message: 'Acceso denegado.' });
    }
    
    try {
        classId = classId || gymClassId;
        if (!userId || !classId) {
            return res.status(400).json({ message: 'userId y classId son requeridos.' });
        }
        const gymClass = await GymClass.findById(classId);
        if (!gymClass) {
            return res.status(404).json({ message: 'Clase no encontrada.' });
        }

        if (gymClass.currentCapacity >= gymClass.maxCapacity) {
            return res.status(400).json({ message: 'No hay cupo disponible para esta clase.' });
        }

        // CALCULAR FECHA REAL DE LA CLASE (Fecha y hora de inicio)
        const dateBase = calculateNextClassDate(gymClass.schedule.day, gymClass.schedule.startTime);
        if (!dateBase) {
             return res.status(400).json({ message: 'Día de la semana de la clase no válido.' });
        }
        
        // Usamos el resultado de calculateNextClassDate (sin hora) y le agregamos la hora
        const startDateTime = parseTimeToDate(dateBase, gymClass.schedule.startTime);
        const endDateTime = parseTimeToDate(dateBase, gymClass.schedule.endTime || gymClass.schedule.startTime);

        // Validación: no permitir reservar en el pasado
        if (endDateTime < new Date()) {
            return res.status(400).json({ message: 'La clase ya ocurrió. No es posible reservar.' });
        }

        // Validación: evitar doble reserva del mismo turno (por fecha real y hora de inicio)
        const existingSame = await Reservation.findOne({ 
            userId, 
            classId, 
            classDate: startDateTime,
            status: { $in: ['active'] } 
        });
        if (existingSame) {
            return res.status(400).json({ message: 'Ya tienes una reserva activa para esta clase.' });
        }

        // Validación: evitar solapamiento con otras reservas activas 
        const userActive = await Reservation.find({ userId, status: 'active' }).populate('classId');
        const overlaps = userActive.some(r => {
            const c = r.classId;
            if (!c) return false;
            
            // Comparar el día de la semana
            const classDay = c.schedule.day.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const newClassDay = gymClass.schedule.day.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            if (classDay !== newClassDay) return false;
            
            // Usamos la fecha real de la clase que estamos reservando (startDateTime) como base para comparar los horarios
            const rStart = parseTimeToDate(startDateTime, c.schedule.startTime);
            const rEnd = parseTimeToDate(startDateTime, c.schedule.endTime || c.schedule.startTime);
            
            // Lógica de solapamiento: [A, B) y [C, D) se solapan si A < D y C < B
            return (startDateTime < rEnd && endDateTime > rStart);
        });
        if (overlaps) {
            return res.status(400).json({ message: 'Tienes otra reserva activa que se superpone en el mismo horario.' });
        }

        // Usamos la fecha y hora de inicio real de la clase en la nueva reserva
        const newReservation = new Reservation({ 
            userId, 
            classId, 
            classDate: startDateTime, 
            reservationDate: new Date()
        });
        await newReservation.save();

        // Actualizar cupo en GymClass 
        gymClass.currentCapacity = (gymClass.currentCapacity || 0) + 1;
        await gymClass.save();

        res.status(201).json(newReservation);
    } catch (error) {
        console.error('Error al crear la reserva:', error);
        res.status(500).json({ message: 'Error al crear la reserva', error: error.message });
    }
});

// Ruta para cancelar una reserva 
app.post('/api/reservations/cancel/:reservationId', auth, async (req, res) => {
    const { reservationId } = req.params;
    try {
        const reservation = await Reservation.findById(reservationId);
        if (!reservation) {
            return res.status(404).json({ message: 'Reserva no encontrada.' });
        }
        
        // Verificar que el token pertenezca al usuario de la reserva
        if (req.user.userId !== reservation.userId.toString()) {
            return res.status(403).json({ message: 'Acceso denegado: No tienes permiso para cancelar esta reserva.' });
        }

        if (reservation.status !== 'active') {
            return res.status(400).json({ message: 'Solo se pueden cancelar reservas activas.' });
        }
        
        // Validar que la cancelación sea antes de que termine la clase
        const gymClass = await GymClass.findById(reservation.classId);
        if (gymClass && reservation.classDate) {
             const endDateTime = parseTimeToDate(reservation.classDate, gymClass.schedule.endTime || gymClass.schedule.startTime);
             if (endDateTime < new Date()) {
                 return res.status(400).json({ message: 'No se puede cancelar una clase que ya ha finalizado.' });
             }
        }


        reservation.status = 'cancelled';
        await reservation.save();

        // Liberar cupo
        if (gymClass && (gymClass.currentCapacity||0) > 0) {
            gymClass.currentCapacity -= 1;
            await gymClass.save();
        }

        res.status(200).json({ message: 'Reserva cancelada exitosamente' });
    } catch (error) {
        res.status(500).json({ message: 'Error al cancelar la reserva', error });
    }
});

// =========================================================================
// RUTAS DE HISTORIAL (PROTEGIDAS)
// =========================================================================

// Ruta para obtener el historial de asistencias de un usuario
app.get('/api/history/:userId', auth, async (req, res) => {
    const { userId } = req.params;
    const { startDate, endDate } = req.query; 

    if (req.user.userId !== userId) {
        return res.status(403).json({ message: 'Acceso denegado.' });
    }

    try {
        let findCriteria = { 
            userId, 
            status: { $in: ['attended', 'cancelled', 'expired'] } 
        };

        // Aplicamos el filtro de fecha real de la clase (classDate)
        if (startDate || endDate) {
            findCriteria.classDate = {};

            if (startDate) {
                // Inicio del día
                findCriteria.classDate.$gte = new Date(new Date(startDate).setHours(0, 0, 0, 0));
            }

            if (endDate) {
                // Fin del día
                findCriteria.classDate.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
            }
        }

        const history = await Reservation.find(findCriteria)
            .populate('classId')
            .sort({ classDate: -1 });

        res.status(200).json(history);
    } catch (error) {
        console.error('Error al obtener el historial:', error);
        res.status(500).json({ message: 'Error al obtener el historial de asistencias', error });
    }
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});