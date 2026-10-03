use rusqlite::Connection;
use std::sync::Mutex;

/// The open database connection. One connection per app (MVP).
#[derive(Default)]
pub struct AppDb(pub Mutex<Option<Connection>>);
