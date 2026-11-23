use super::*;

#[test]
fn a_304_reuses_only_the_tag_previously_cached_for_the_same_channel() {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/latest.json", server.local_addr().unwrap());
    let fixture = std::thread::spawn(move || {
        let body = r#"{"tag":"v2.0.0"}"#;
        for check in 0..3 {
            let (mut stream, _) = server.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = BufReader::new(&stream);
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                if request.read_line(&mut line).unwrap() == 0 || line == "\r\n" { break; }
                headers.push_str(&line.to_lowercase());
            }
            assert_eq!(headers.contains("if-none-match: \"feed\""), check == 1);
            if check == 0 {
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nETag: \"feed\"\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            } else {
                write!(stream, "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n").unwrap();
            }
        }
    });
    let client = release_client(Duration::from_secs(5)).unwrap();
    let feeds = Mutex::new(HashMap::new());
    tauri::async_runtime::block_on(async {
        for _ in 0..2 {
            assert_eq!(read_feed(&client, &url, Track::Stable, &feeds).await.unwrap().unwrap().tag, "v2.0.0");
        }
        assert!(read_feed(&client, &url, Track::Nightly, &feeds).await.is_err());
    });
    fixture.join().unwrap();
}
