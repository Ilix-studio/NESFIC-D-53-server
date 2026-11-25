import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

export async function connectDb(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export function dbState() {
  return STATES[mongoose.connection.readyState] ?? 'unknown';
}
