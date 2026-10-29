#[tokio::main]
async fn main() {
    let port = std::env::var("MUSIC_PORT")
        .unwrap_or("3210".into())
        .parse::<u16>()
        .expect("MUSIC_PORT must be a port number");
    let root = std::env::var("MUSIC_DATA").unwrap_or("data".into());
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .expect("cannot bind; port occupied, no process was stopped");
    println!("声笺 http://127.0.0.1:{port} data={root}");
    axum::serve(
        listener,
        music_practice::server::app(std::path::Path::new(&root)),
    )
    .with_graceful_shutdown(async {
        tokio::signal::ctrl_c().await.ok();
    })
    .await
    .expect("server failed");
}
