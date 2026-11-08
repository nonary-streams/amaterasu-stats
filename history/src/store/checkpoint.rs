//! Keeps WAL checkpoints, and the fsyncs they perform, off the host tick.
//!
//! A commit with `synchronous = NORMAL` only appends to the write-ahead log. The
//! expensive durability work happens when that log is folded into the database,
//! which SQLite would otherwise do inside whichever commit crosses its size
//! limit. Commits run on the host's module thread, so that fsync stalls video.
use rusqlite::{Connection, OpenFlags};
use std::{
    path::{Path, PathBuf},
    sync::mpsc::{RecvTimeoutError, SyncSender, sync_channel},
    thread::{self, JoinHandle},
    time::Duration,
};

const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(30);

/// Commits fold the log themselves only past this many pages, which bounds the
/// log if the background worker cannot run. A healthy worker never reaches it.
pub(super) const WAL_BACKSTOP_PAGES: i64 = 20_000;

pub(super) struct BackgroundCheckpoint {
    stop: Option<SyncSender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl BackgroundCheckpoint {
    pub(super) fn start(path: PathBuf) -> Self {
        let (stop, stopped) = sync_channel::<()>(0);
        let worker = thread::Builder::new()
            .name("history-checkpoint".into())
            .spawn(move || {
                while matches!(
                    stopped.recv_timeout(CHECKPOINT_INTERVAL),
                    Err(RecvTimeoutError::Timeout)
                ) {
                    // A busy or missing database is retried at the next interval.
                    let _ = checkpoint(&path);
                }
            })
            .ok();
        Self {
            stop: Some(stop),
            worker,
        }
    }
}

impl Drop for BackgroundCheckpoint {
    fn drop(&mut self) {
        self.stop.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Folds the log without blocking writers. Returns the frames checkpointed.
pub(super) fn checkpoint(path: &Path) -> rusqlite::Result<i64> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    connection.busy_timeout(Duration::ZERO)?;
    connection.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| row.get(2))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "amaterasu-history-checkpoint-{name}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        directory.join("history.db")
    }

    fn write_rows(connection: &Connection) {
        for value in 0..32 {
            connection
                .execute("INSERT INTO samples (value) VALUES (?1)", [value])
                .unwrap();
        }
    }

    fn open_with_backstop(path: &Path) -> Connection {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(&format!(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA wal_autocheckpoint = {WAL_BACKSTOP_PAGES};
                 CREATE TABLE IF NOT EXISTS samples (value INTEGER);"
            ))
            .unwrap();
        connection
    }

    #[test]
    fn a_separate_connection_folds_the_log_while_the_writer_stays_open() {
        let path = database("fold");
        let writer = open_with_backstop(&path);
        write_rows(&writer);

        assert!(checkpoint(&path).unwrap() > 0);

        let rows: i64 = writer
            .query_row("SELECT count(*) FROM samples", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 32);
    }

    #[test]
    fn writers_do_not_checkpoint_until_the_backstop() {
        let path = database("backstop");
        let writer = open_with_backstop(&path);
        write_rows(&writer);

        let pending: i64 = writer
            .query_row("PRAGMA wal_checkpoint(NOOP)", [], |row| row.get(1))
            .unwrap_or(1);
        assert!(pending > 0, "the commit left its pages in the log");
        let limit: i64 = writer
            .query_row("PRAGMA wal_autocheckpoint", [], |row| row.get(0))
            .unwrap();
        assert_eq!(limit, WAL_BACKSTOP_PAGES);
    }

    #[test]
    fn a_missing_database_is_an_error_and_is_not_created() {
        let path = database("missing").with_file_name("absent.db");

        assert!(checkpoint(&path).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn dropping_the_worker_stops_it_promptly() {
        let started = std::time::Instant::now();
        drop(BackgroundCheckpoint::start(database("stop")));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
