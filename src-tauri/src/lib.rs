//! Forge DSP desktop app (Tauri): the web GUI in the system webview, plus what a browser page
//! cannot do on every platform:
//!  - serial ports (WebKit on macOS/Linux has no Web Serial): list, open, write, read as a stream
//!  - writing a file chosen in the native "save as" dialog (the dialog itself: tauri-plugin-dialog)
//!  - HTTP GET to GitHub for the firmware releases (no CORS in the app), GitHub hosts only
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Serialize)]
struct PortInfo {
    name: String,
    vid: Option<u16>,
    pid: Option<u16>,
    product: Option<String>,
}

#[derive(Default)]
struct Serial {
    port: Mutex<Option<Box<dyn serialport::SerialPort>>>,
    reading: Mutex<Option<Arc<AtomicBool>>>,
}

#[tauri::command]
fn serial_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(u) => PortInfo { name: p.port_name, vid: Some(u.vid), pid: Some(u.pid), product: u.product },
            _ => PortInfo { name: p.port_name, vid: None, pid: None, product: None },
        })
        .collect())
}

fn stop(state: &Serial) {
    if let Some(run) = state.reading.lock().unwrap().take() {
        run.store(false, Ordering::SeqCst);
    }
    state.port.lock().unwrap().take();
}

/// Opens a port (8N1) and streams everything it receives to `on_data`.
#[tauri::command(async)]
fn serial_open(state: State<'_, Serial>, path: String, baud: u32, on_data: Channel<Vec<u8>>) -> Result<(), String> {
    stop(&state);
    let port = serialport::new(&path, baud)
        .data_bits(serialport::DataBits::Eight)
        .parity(serialport::Parity::None)
        .stop_bits(serialport::StopBits::One)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| format!("{path}: {e}"))?;
    let mut reader = port.try_clone().map_err(|e| e.to_string())?;
    let run = Arc::new(AtomicBool::new(true));
    let alive = run.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while alive.load(Ordering::SeqCst) {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => {
                    if on_data.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => break, // unplugged
            }
        }
    });
    *state.port.lock().unwrap() = Some(port);
    *state.reading.lock().unwrap() = Some(run);
    Ok(())
}

#[tauri::command(async)]
fn serial_write(state: State<'_, Serial>, data: Vec<u8>) -> Result<(), String> {
    let mut guard = state.port.lock().unwrap();
    let port = guard.as_mut().ok_or("not connected")?;
    port.write_all(&data).map_err(|e| e.to_string())?;
    port.flush().map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn serial_close(state: State<'_, Serial>) -> Result<(), String> {
    stop(&state);
    Ok(())
}

/// Writes a file the user picked in the save dialog.
#[tauri::command(async)]
fn write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| format!("{path}: {e}"))
}

const GITHUB: [&str; 2] = ["https://api.github.com/", "https://github.com/"];

/// GET from GitHub (release list and release files; redirects to GitHub's file hosts are followed).
#[tauri::command(async)]
fn http_get(url: String) -> Result<Vec<u8>, String> {
    if !GITHUB.iter().any(|p| url.starts_with(p)) {
        return Err(format!("not allowed: {url}"));
    }
    let mut r = ureq::get(&url)
        .header("User-Agent", "forge-dsp-desktop")
        .header("Accept", if url.contains("api.github.com") { "application/vnd.github+json" } else { "application/octet-stream" })
        .call()
        .map_err(|e| format!("{url}: {e}"))?;
    r.body_mut().with_config().limit(16 * 1024 * 1024).read_to_vec().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Serial::default())
        .invoke_handler(tauri::generate_handler![serial_ports, serial_open, serial_write, serial_close, write_file, http_get])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
