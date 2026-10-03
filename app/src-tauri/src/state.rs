use rusqlite::Connection;
use std::sync::Mutex;

/// Открытое соединение с БД. Одно соединение на приложение (MVP).
#[derive(Default)]
pub struct AppDb(pub Mutex<Option<Connection>>);
