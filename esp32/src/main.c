/*
 * Forge DSP bridge for an ESP32 at the RS485 master/slave port of a Forge DSP.
 *  - WLAN access point (and optionally a station in an existing WLAN)
 *  - GET /          the web app (gzip, embedded in the firmware)
 *  - GET /api/info  {"bridge":"forge-dsp",...}: lets the app detect the bridge
 *  - WS  /ws        text frames -> UART (one protocol line each); every line from the
 *                   Forge -> text frame to all connected clients
 * UART: 38400 8N1 to a 3.3 V full-duplex transceiver (MAX3490 class), wiring in
 * docs/hardware-esp32.md.
 */
#include <string.h>
#include "driver/uart.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#define UART_PORT UART_NUM_1
#define FORGE_LINE_MAX 512
#define MAX_CLIENTS 4

static const char *TAG = "forge-bridge";
extern const uint8_t web_start[] asm("_binary_index_html_gz_start");
extern const uint8_t web_end[] asm("_binary_index_html_gz_end");

static httpd_handle_t server;
static int clients[MAX_CLIENTS];
static SemaphoreHandle_t clients_lock;

/* --- WebSocket clients ------------------------------------------------------------- */

static void client_add(int fd)
{
	xSemaphoreTake(clients_lock, portMAX_DELAY);
	for (int i = 0; i < MAX_CLIENTS; i++)
		if (clients[i] < 0) {
			clients[i] = fd;
			break;
		}
	xSemaphoreGive(clients_lock);
}

static void broadcast(const char *line, size_t len)
{
	httpd_ws_frame_t f = {.type = HTTPD_WS_TYPE_TEXT, .payload = (uint8_t *)line, .len = len, .final = true};
	xSemaphoreTake(clients_lock, portMAX_DELAY);
	for (int i = 0; i < MAX_CLIENTS; i++) {
		if (clients[i] < 0)
			continue;
		if (httpd_ws_get_fd_info(server, clients[i]) != HTTPD_WS_CLIENT_WEBSOCKET
		    || httpd_ws_send_frame_async(server, clients[i], &f) != ESP_OK)
			clients[i] = -1;  /* gone */
	}
	xSemaphoreGive(clients_lock);
}

/* --- HTTP -------------------------------------------------------------------------- */

static esp_err_t get_index(httpd_req_t *req)
{
	httpd_resp_set_type(req, "text/html; charset=utf-8");
	httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
	httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
	return httpd_resp_send(req, (const char *)web_start, web_end - web_start);
}

static esp_err_t get_info(httpd_req_t *req)
{
	char body[96];
	snprintf(body, sizeof body, "{\"bridge\":\"forge-dsp\",\"baud\":%d}", CONFIG_FORGE_UART_BAUD);
	httpd_resp_set_type(req, "application/json");
	return httpd_resp_sendstr(req, body);
}

static esp_err_t ws_handler(httpd_req_t *req)
{
	if (req->method == HTTP_GET) {  /* handshake */
		client_add(httpd_req_to_sockfd(req));
		return ESP_OK;
	}
	httpd_ws_frame_t f = {.type = HTTPD_WS_TYPE_TEXT};
	esp_err_t e = httpd_ws_recv_frame(req, &f, 0);  /* length only */
	if (e != ESP_OK || f.type != HTTPD_WS_TYPE_TEXT || f.len == 0 || f.len > FORGE_LINE_MAX)
		return e;
	uint8_t buf[FORGE_LINE_MAX + 2];
	f.payload = buf;
	if ((e = httpd_ws_recv_frame(req, &f, f.len)) != ESP_OK)
		return e;
	size_t n = f.len;
	if (buf[n - 1] != '\n') {  /* the Forge ends a line at LF */
		buf[n++] = '\r';
		buf[n++] = '\n';
	}
	uart_write_bytes(UART_PORT, buf, n);
	return ESP_OK;
}

static void start_http(void)
{
	httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
	cfg.max_open_sockets = MAX_CLIENTS + 3;
	ESP_ERROR_CHECK(httpd_start(&server, &cfg));
	static const httpd_uri_t uris[] = {
		{.uri = "/", .method = HTTP_GET, .handler = get_index},
		{.uri = "/index.html", .method = HTTP_GET, .handler = get_index},
		{.uri = "/api/info", .method = HTTP_GET, .handler = get_info},
		{.uri = "/ws", .method = HTTP_GET, .handler = ws_handler, .is_websocket = true},
	};
	for (size_t i = 0; i < sizeof uris / sizeof uris[0]; i++)
		httpd_register_uri_handler(server, &uris[i]);
}

/* --- UART -------------------------------------------------------------------------- */

static void uart_task(void *arg)
{
	(void)arg;
	static char line[FORGE_LINE_MAX + 1];
	size_t n = 0;
	uint8_t chunk[128];
	for (;;) {
		int got = uart_read_bytes(UART_PORT, chunk, sizeof chunk, pdMS_TO_TICKS(50));
		for (int i = 0; i < got; i++) {
			if (n < FORGE_LINE_MAX)
				line[n++] = (char)chunk[i];
			if (chunk[i] == '\n' || n == FORGE_LINE_MAX) {
				broadcast(line, n);
				n = 0;
			}
		}
	}
}

static void start_uart(void)
{
	const uart_config_t c = {
		.baud_rate = CONFIG_FORGE_UART_BAUD,
		.data_bits = UART_DATA_8_BITS,
		.parity = UART_PARITY_DISABLE,
		.stop_bits = UART_STOP_BITS_1,
		.flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
		.source_clk = UART_SCLK_DEFAULT,
	};
	ESP_ERROR_CHECK(uart_driver_install(UART_PORT, 2048, 2048, 0, NULL, 0));
	ESP_ERROR_CHECK(uart_param_config(UART_PORT, &c));
	ESP_ERROR_CHECK(uart_set_pin(UART_PORT, CONFIG_FORGE_UART_TX_GPIO, CONFIG_FORGE_UART_RX_GPIO,
	                             UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
	xTaskCreate(uart_task, "uart", 4096, NULL, 10, NULL);
}

/* --- WLAN -------------------------------------------------------------------------- */

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data)
{
	(void)arg;
	(void)data;
	if (base == WIFI_EVENT && (id == WIFI_EVENT_STA_START || id == WIFI_EVENT_STA_DISCONNECTED))
		esp_wifi_connect();
	else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP)
		ESP_LOGI(TAG, "station: " IPSTR, IP2STR(&((ip_event_got_ip_t *)data)->ip_info.ip));
}

static void start_wifi(void)
{
	ESP_ERROR_CHECK(esp_netif_init());
	ESP_ERROR_CHECK(esp_event_loop_create_default());
	esp_netif_create_default_wifi_ap();
	const int sta = strlen(CONFIG_FORGE_STA_SSID) > 0;
	if (sta)
		esp_netif_create_default_wifi_sta();
	wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
	ESP_ERROR_CHECK(esp_wifi_init(&init));
	ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, NULL));
	ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, NULL));

	wifi_config_t ap = {.ap = {.max_connection = MAX_CLIENTS, .authmode = WIFI_AUTH_WPA2_PSK}};
	strlcpy((char *)ap.ap.ssid, CONFIG_FORGE_AP_SSID, sizeof ap.ap.ssid);
	strlcpy((char *)ap.ap.password, CONFIG_FORGE_AP_PASSWORD, sizeof ap.ap.password);
	ESP_ERROR_CHECK(esp_wifi_set_mode(sta ? WIFI_MODE_APSTA : WIFI_MODE_AP));
	ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));
	if (sta) {
		wifi_config_t st = {0};
		strlcpy((char *)st.sta.ssid, CONFIG_FORGE_STA_SSID, sizeof st.sta.ssid);
		strlcpy((char *)st.sta.password, CONFIG_FORGE_STA_PASSWORD, sizeof st.sta.password);
		ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &st));
	}
	ESP_ERROR_CHECK(esp_wifi_start());
	ESP_LOGI(TAG, "access point \"%s\", http://192.168.4.1/", CONFIG_FORGE_AP_SSID);
}

void app_main(void)
{
	esp_err_t e = nvs_flash_init();
	if (e == ESP_ERR_NVS_NO_FREE_PAGES || e == ESP_ERR_NVS_NEW_VERSION_FOUND) {
		ESP_ERROR_CHECK(nvs_flash_erase());
		e = nvs_flash_init();
	}
	ESP_ERROR_CHECK(e);
	for (int i = 0; i < MAX_CLIENTS; i++)
		clients[i] = -1;
	clients_lock = xSemaphoreCreateMutex();
	start_uart();
	start_wifi();
	start_http();
}
