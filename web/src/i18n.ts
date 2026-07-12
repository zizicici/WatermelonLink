export type Locale = "en" | "zh-Hans" | "zh-Hant" | "ja" | "ko" | "de" | "fr" | "es" | "es-419" | "pt-BR" | "pt-PT" | "ru" | "uk";

const supportedLocales: readonly Locale[] = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "fr", "es", "es-419", "pt-BR", "pt-PT", "ru", "uk"];

const en = {
  brand: "Watermelon Backup", homepage: "Homepage", language: "Language", navOpen: "Open navigation", navPrivacy: "Privacy", navPricing: "Pricing", navFAQ: "FAQ", navSpecs: "Specifications", navContact: "Contact", privacyPolicy: "Privacy Policy", footerNav: "Footer navigation",
  eyebrow: "BACK UP TO THIS COMPUTER", title: "Your computer is the destination.", intro: "Choose a folder, scan once with your iPhone, and keep every original on your own computer.", local: "Local network transfer", private: "No photo cloud relay", temporary: "One-time secure link",
  panelTitle: "One-Time Connection over Your Local Network", panelIntro: "Watermelon Link works while this page and the Watermelon app stay open.", statusReady: "Ready", statusPreparing: "Preparing", statusWaiting: "Waiting", statusConnecting: "Connecting", statusDirect: "Direct", statusAction: "Action Needed",
  chooseTitle: "Choose a Backup Folder", chooseDetail: "The page can only access the folder you approve.", choose: "Choose", change: "Change", connectTitle: "Create a Secure Link", connectDetail: "Keep both devices on the same Wi-Fi. Turn off VPN if connection fails.", connect: "Create", preparing: "Preparing Secure Link…", waitingTitle: "Scan with Watermelon Backup", waitingDetail: "Open Watermelon on your iPhone and scan this QR code.", expires: "Expires in", cancel: "Cancel", connectingTitle: "Connecting Directly…", connectingDetail: "Your devices are negotiating a local WebRTC connection.", connectedTitle: "Secure Local Connection Ready", connectedDetail: "Signaling has ended. Your devices are now connected directly.",
  browserUnsupported: "Use the latest Chrome or Edge on macOS or Windows to choose a folder.", secureContextRequired: "Folder access requires HTTPS or localhost.", folderCancelled: "No folder was selected.", connectionFailed: "The secure link could not be created. Please try again.", pairingExpired: "This pairing link expired. Create a new one.", directNote: "If direct connection fails, check that both devices use the same Wi-Fi and turn off VPN.", handoffTitle: "Open This Link in Watermelon Backup", handoffDetail: "This pairing link is intended for the Watermelon iOS app.", appStore: "Get Watermelon Backup"
} as const;

type Messages = { [Key in keyof typeof en]: string };
export type MessageKey = keyof Messages;
const pack = (overrides: Partial<Messages>): Messages => ({ ...en, ...overrides });

const zhHans = pack({
  brand: "西瓜备份", homepage: "官网", language: "语言", navOpen: "打开菜单", navPrivacy: "隐私", navPricing: "价格", navFAQ: "常见问题", navSpecs: "规格参数", navContact: "联系我们", privacyPolicy: "隐私政策", footerNav: "页脚导航",
  eyebrow: "备份到这台电脑", title: "电脑就是备份目的地。", intro: "选择一个文件夹，用 iPhone 扫描一次，原片就保存在你自己的电脑里。", local: "局域网直传", private: "照片不经过云端", temporary: "一次性安全连接",
  panelTitle: "通过局域网建立一次性连接", panelIntro: "传输期间请保持此页面和西瓜备份 App 打开。", statusReady: "就绪", statusPreparing: "准备中", statusWaiting: "等待扫描", statusConnecting: "连接中", statusDirect: "已直连", statusAction: "需要处理",
  chooseTitle: "选择备份文件夹", chooseDetail: "网页只能访问你明确授权的文件夹。", choose: "选择", change: "更换", connectTitle: "创建安全连接", connectDetail: "请让两台设备连接同一 Wi-Fi；如果连接失败，请关闭 VPN。", connect: "创建", preparing: "正在创建安全连接…", waitingTitle: "使用西瓜备份扫描", waitingDetail: "在 iPhone 打开西瓜备份，然后扫描此二维码。", expires: "剩余", cancel: "取消", connectingTitle: "正在建立直连…", connectingDetail: "两台设备正在协商局域网 WebRTC 连接。", connectedTitle: "安全局域网连接已就绪", connectedDetail: "信令已经结束，两台设备现在直接连接。",
  browserUnsupported: "请在 macOS 或 Windows 使用最新版 Chrome 或 Edge 选择文件夹。", secureContextRequired: "文件夹访问需要 HTTPS 或 localhost。", folderCancelled: "没有选择文件夹。", connectionFailed: "无法创建安全连接，请重试。", pairingExpired: "配对连接已过期，请重新创建。", directNote: "如果无法直连，请确认两台设备连接同一 Wi-Fi，并关闭 VPN。", handoffTitle: "请使用西瓜备份打开此连接", handoffDetail: "这个配对链接需要交给西瓜备份 iOS App。", appStore: "获取西瓜备份"
});

const zhHant = pack({
  brand: "西瓜備份", homepage: "官網", language: "語言", navOpen: "開啟選單", navPrivacy: "隱私", navPricing: "價格", navFAQ: "常見問題", navSpecs: "規格參數", navContact: "聯絡我們", privacyPolicy: "隱私權政策", footerNav: "頁尾導覽",
  eyebrow: "備份到這台電腦", title: "電腦就是備份目的地。", intro: "選擇一個資料夾，用 iPhone 掃描一次，原始檔案就保存在你自己的電腦裡。", local: "區域網路直傳", private: "照片不經過雲端", temporary: "一次性安全連線",
  panelTitle: "透過區域網路建立一次性連線", panelIntro: "傳輸期間請保持此頁面和西瓜備份 App 開啟。", statusReady: "就緒", statusPreparing: "準備中", statusWaiting: "等待掃描", statusConnecting: "連線中", statusDirect: "已直連", statusAction: "需要處理",
  chooseTitle: "選擇備份資料夾", chooseDetail: "網頁只能存取你明確授權的資料夾。", choose: "選擇", change: "更換", connectTitle: "建立安全連線", connectDetail: "請讓兩台裝置連接同一 Wi-Fi；如果連線失敗，請關閉 VPN。", connect: "建立", preparing: "正在建立安全連線…", waitingTitle: "使用西瓜備份掃描", waitingDetail: "在 iPhone 開啟西瓜備份，然後掃描此 QR Code。", expires: "剩餘", cancel: "取消", connectingTitle: "正在建立直連…", connectingDetail: "兩台裝置正在協商區域網路 WebRTC 連線。", connectedTitle: "安全區域網路連線已就緒", connectedDetail: "信令已經結束，兩台裝置現在直接連線。",
  browserUnsupported: "請在 macOS 或 Windows 使用最新版 Chrome 或 Edge 選擇資料夾。", secureContextRequired: "資料夾存取需要 HTTPS 或 localhost。", folderCancelled: "沒有選擇資料夾。", connectionFailed: "無法建立安全連線，請重試。", pairingExpired: "配對連線已過期，請重新建立。", directNote: "如果無法直連，請確認兩台裝置連接同一 Wi-Fi，並關閉 VPN。", handoffTitle: "請使用西瓜備份開啟此連線", handoffDetail: "這個配對連結需要交給西瓜備份 iOS App。", appStore: "取得西瓜備份"
});

const ja = pack({
  brand: "スイカバックアップ", homepage: "ホームページ", language: "言語", navOpen: "ナビゲーションを開く", navPrivacy: "プライバシー", navPricing: "価格", navFAQ: "FAQ", navSpecs: "仕様", navContact: "お問い合わせ", privacyPolicy: "プライバシーポリシー", footerNav: "フッターのナビゲーション",
  eyebrow: "このコンピュータにバックアップ", title: "このコンピュータをバックアップ先に。", intro: "フォルダを選び、iPhoneで一度スキャンするだけ。オリジナルは自分のコンピュータに保存されます。", local: "ローカルネットワーク転送", private: "写真はクラウドを経由しません", temporary: "一回限りの安全な接続",
  panelTitle: "ローカルネットワークで一回限りの接続", panelIntro: "転送中はこのページとスイカバックアップを開いたままにしてください。", statusReady: "準備完了", statusPreparing: "準備中", statusWaiting: "スキャン待ち", statusConnecting: "接続中", statusDirect: "直接接続", statusAction: "確認が必要",
  chooseTitle: "バックアップフォルダを選択", chooseDetail: "このページは許可したフォルダだけにアクセスできます。", choose: "選択", change: "変更", connectTitle: "安全なリンクを作成", connectDetail: "両方のデバイスを同じWi-Fiに接続してください。接続できない場合はVPNをオフにしてください。", connect: "作成", preparing: "安全なリンクを準備中…", waitingTitle: "スイカバックアップでスキャン", waitingDetail: "iPhoneでスイカバックアップを開き、このQRコードをスキャンしてください。", expires: "有効期限", cancel: "キャンセル", connectingTitle: "直接接続中…", connectingDetail: "デバイス間でローカルWebRTC接続を確立しています。", connectedTitle: "安全なローカル接続の準備完了", connectedDetail: "シグナリングは終了し、デバイス同士が直接接続されました。",
  browserUnsupported: "macOSまたはWindowsの最新のChromeかEdgeでフォルダを選択してください。", secureContextRequired: "フォルダへのアクセスにはHTTPSまたはlocalhostが必要です。", folderCancelled: "フォルダが選択されていません。", connectionFailed: "安全なリンクを作成できませんでした。もう一度お試しください。", pairingExpired: "ペアリングリンクの期限が切れました。新しく作成してください。", directNote: "直接接続できない場合は、両方のデバイスが同じWi-Fiに接続され、VPNがオフになっていることを確認してください。", handoffTitle: "スイカバックアップでこのリンクを開く", handoffDetail: "このペアリングリンクはスイカバックアップiOSアプリ用です。", appStore: "スイカバックアップを入手"
});

const ko = pack({
  brand: "수박 백업", homepage: "홈페이지", language: "언어", navOpen: "내비게이션 열기", navPrivacy: "개인정보", navPricing: "가격", navFAQ: "FAQ", navSpecs: "사양", navContact: "문의하기", privacyPolicy: "개인정보 처리방침", footerNav: "푸터 내비게이션",
  eyebrow: "이 컴퓨터에 백업", title: "이 컴퓨터가 백업 대상입니다.", intro: "폴더를 선택하고 iPhone으로 한 번 스캔하면 원본이 내 컴퓨터에 저장됩니다.", local: "로컬 네트워크 전송", private: "사진이 클라우드를 거치지 않음", temporary: "일회용 보안 연결",
  panelTitle: "로컬 네트워크에서 일회용 연결", panelIntro: "전송 중에는 이 페이지와 수박 백업 앱을 열어 두세요.", statusReady: "준비됨", statusPreparing: "준비 중", statusWaiting: "스캔 대기", statusConnecting: "연결 중", statusDirect: "직접 연결", statusAction: "확인 필요",
  chooseTitle: "백업 폴더 선택", chooseDetail: "이 페이지는 사용자가 허용한 폴더에만 접근할 수 있습니다.", choose: "선택", change: "변경", connectTitle: "보안 링크 만들기", connectDetail: "두 기기를 같은 Wi-Fi에 연결하세요. 연결되지 않으면 VPN을 끄세요.", connect: "만들기", preparing: "보안 링크 준비 중…", waitingTitle: "수박 백업으로 스캔", waitingDetail: "iPhone에서 수박 백업을 열고 이 QR 코드를 스캔하세요.", expires: "남은 시간", cancel: "취소", connectingTitle: "직접 연결 중…", connectingDetail: "두 기기가 로컬 WebRTC 연결을 협상하고 있습니다.", connectedTitle: "안전한 로컬 연결 준비 완료", connectedDetail: "시그널링이 종료되었으며 두 기기가 직접 연결되었습니다.",
  browserUnsupported: "macOS 또는 Windows에서 최신 Chrome이나 Edge로 폴더를 선택하세요.", secureContextRequired: "폴더 접근에는 HTTPS 또는 localhost가 필요합니다.", folderCancelled: "폴더를 선택하지 않았습니다.", connectionFailed: "보안 링크를 만들 수 없습니다. 다시 시도하세요.", pairingExpired: "페어링 링크가 만료되었습니다. 새로 만드세요.", directNote: "직접 연결되지 않으면 두 기기가 같은 Wi-Fi에 연결되어 있고 VPN이 꺼져 있는지 확인하세요.", handoffTitle: "수박 백업에서 이 링크 열기", handoffDetail: "이 페어링 링크는 수박 백업 iOS 앱용입니다.", appStore: "수박 백업 받기"
});

const de = pack({
  brand: "Melon Backup", homepage: "Startseite", language: "Sprache", navOpen: "Navigation öffnen", navPrivacy: "Datenschutz", navPricing: "Preise", navFAQ: "FAQ", navSpecs: "Technische Daten", navContact: "Kontakt", privacyPolicy: "Datenschutzerklärung", footerNav: "Navigation im Footer",
  eyebrow: "AUF DIESEM COMPUTER SICHERN", title: "Ihr Computer ist das Sicherungsziel.", intro: "Wählen Sie einen Ordner, scannen Sie einmal mit dem iPhone und speichern Sie jedes Original auf Ihrem eigenen Computer.", local: "Übertragung im lokalen Netzwerk", private: "Keine Foto-Weiterleitung über die Cloud", temporary: "Einmalige sichere Verbindung",
  panelTitle: "Einmalige Verbindung im lokalen Netzwerk", panelIntro: "Lassen Sie diese Seite und Melon Backup während der Übertragung geöffnet.", statusReady: "Bereit", statusPreparing: "Vorbereitung", statusWaiting: "Warten", statusConnecting: "Verbinden", statusDirect: "Direkt", statusAction: "Aktion erforderlich",
  chooseTitle: "Sicherungsordner auswählen", chooseDetail: "Die Seite kann nur auf den von Ihnen freigegebenen Ordner zugreifen.", choose: "Auswählen", change: "Ändern", connectTitle: "Sichere Verbindung erstellen", connectDetail: "Verbinden Sie beide Geräte mit demselben WLAN. Deaktivieren Sie VPN, falls die Verbindung fehlschlägt.", connect: "Erstellen", preparing: "Sichere Verbindung wird vorbereitet…", waitingTitle: "Mit Melon Backup scannen", waitingDetail: "Öffnen Sie Melon Backup auf dem iPhone und scannen Sie diesen QR-Code.", expires: "Läuft ab in", cancel: "Abbrechen", connectingTitle: "Direkte Verbindung wird hergestellt…", connectingDetail: "Ihre Geräte handeln eine lokale WebRTC-Verbindung aus.", connectedTitle: "Sichere lokale Verbindung bereit", connectedDetail: "Die Signalisierung ist beendet. Ihre Geräte sind jetzt direkt verbunden.",
  browserUnsupported: "Verwenden Sie die aktuelle Version von Chrome oder Edge unter macOS oder Windows.", secureContextRequired: "Der Ordnerzugriff erfordert HTTPS oder localhost.", folderCancelled: "Es wurde kein Ordner ausgewählt.", connectionFailed: "Die sichere Verbindung konnte nicht erstellt werden. Versuchen Sie es erneut.", pairingExpired: "Diese Kopplung ist abgelaufen. Erstellen Sie eine neue.", directNote: "Wenn die direkte Verbindung fehlschlägt, verbinden Sie beide Geräte mit demselben WLAN und deaktivieren Sie VPN.", handoffTitle: "Diesen Link in Melon Backup öffnen", handoffDetail: "Dieser Kopplungslink ist für die Melon Backup iOS-App bestimmt.", appStore: "Melon Backup laden"
});

const fr = pack({
  brand: "Melon Backup", homepage: "Accueil", language: "Langue", navOpen: "Ouvrir la navigation", navPrivacy: "Confidentialité", navPricing: "Tarifs", navFAQ: "FAQ", navSpecs: "Spécifications", navContact: "Contact", privacyPolicy: "Politique de confidentialité", footerNav: "Navigation du pied de page",
  eyebrow: "SAUVEGARDER SUR CET ORDINATEUR", title: "Votre ordinateur est la destination.", intro: "Choisissez un dossier, scannez une fois avec votre iPhone et conservez chaque original sur votre ordinateur.", local: "Transfert sur le réseau local", private: "Aucun relais photo dans le cloud", temporary: "Connexion sécurisée à usage unique",
  panelTitle: "Connexion unique sur votre réseau local", panelIntro: "Gardez cette page et Melon Backup ouverts pendant le transfert.", statusReady: "Prêt", statusPreparing: "Préparation", statusWaiting: "En attente", statusConnecting: "Connexion", statusDirect: "Direct", statusAction: "Action requise",
  chooseTitle: "Choisir un dossier de sauvegarde", chooseDetail: "La page ne peut accéder qu’au dossier que vous autorisez.", choose: "Choisir", change: "Modifier", connectTitle: "Créer un lien sécurisé", connectDetail: "Connectez les deux appareils au même Wi-Fi. Désactivez le VPN si la connexion échoue.", connect: "Créer", preparing: "Préparation du lien sécurisé…", waitingTitle: "Scanner avec Melon Backup", waitingDetail: "Ouvrez Melon Backup sur votre iPhone et scannez ce QR code.", expires: "Expire dans", cancel: "Annuler", connectingTitle: "Connexion directe…", connectingDetail: "Vos appareils négocient une connexion WebRTC locale.", connectedTitle: "Connexion locale sécurisée prête", connectedDetail: "La signalisation est terminée. Vos appareils sont maintenant connectés directement.",
  browserUnsupported: "Utilisez la dernière version de Chrome ou Edge sur macOS ou Windows.", secureContextRequired: "L’accès au dossier nécessite HTTPS ou localhost.", folderCancelled: "Aucun dossier n’a été sélectionné.", connectionFailed: "Le lien sécurisé n’a pas pu être créé. Réessayez.", pairingExpired: "Ce lien d’association a expiré. Créez-en un nouveau.", directNote: "Si la connexion directe échoue, vérifiez que les deux appareils utilisent le même Wi-Fi et désactivez le VPN.", handoffTitle: "Ouvrir ce lien dans Melon Backup", handoffDetail: "Ce lien d’association est destiné à l’app iOS Melon Backup.", appStore: "Obtenir Melon Backup"
});

const es = pack({
  brand: "Backup Sandía", homepage: "Inicio", language: "Idioma", navOpen: "Abrir navegación", navPrivacy: "Privacidad", navPricing: "Precio", navFAQ: "Preguntas frecuentes", navSpecs: "Especificaciones", navContact: "Contacto", privacyPolicy: "Política de privacidad", footerNav: "Navegación del pie de página",
  eyebrow: "COPIA EN ESTE ORDENADOR", title: "Tu ordenador es el destino.", intro: "Elige una carpeta, escanea una vez con el iPhone y conserva cada original en tu propio ordenador.", local: "Transferencia por red local", private: "Las fotos no pasan por la nube", temporary: "Conexión segura de un solo uso",
  panelTitle: "Conexión única en tu red local", panelIntro: "Mantén esta página y Backup Sandía abiertos durante la transferencia.", statusReady: "Listo", statusPreparing: "Preparando", statusWaiting: "Esperando", statusConnecting: "Conectando", statusDirect: "Directa", statusAction: "Requiere atención",
  chooseTitle: "Elige una carpeta de copia", chooseDetail: "La página solo puede acceder a la carpeta que autorices.", choose: "Elegir", change: "Cambiar", connectTitle: "Crear un enlace seguro", connectDetail: "Conecta ambos dispositivos al mismo Wi-Fi. Desactiva la VPN si falla la conexión.", connect: "Crear", preparing: "Preparando el enlace seguro…", waitingTitle: "Escanea con Backup Sandía", waitingDetail: "Abre Backup Sandía en tu iPhone y escanea este código QR.", expires: "Caduca en", cancel: "Cancelar", connectingTitle: "Conectando directamente…", connectingDetail: "Tus dispositivos están negociando una conexión WebRTC local.", connectedTitle: "Conexión local segura lista", connectedDetail: "La señalización ha terminado. Tus dispositivos están conectados directamente.",
  browserUnsupported: "Usa la última versión de Chrome o Edge en macOS o Windows.", secureContextRequired: "El acceso a carpetas requiere HTTPS o localhost.", folderCancelled: "No se seleccionó ninguna carpeta.", connectionFailed: "No se pudo crear el enlace seguro. Inténtalo de nuevo.", pairingExpired: "Este enlace de vinculación caducó. Crea uno nuevo.", directNote: "Si falla la conexión directa, comprueba que ambos dispositivos usan el mismo Wi-Fi y desactiva la VPN.", handoffTitle: "Abre este enlace en Backup Sandía", handoffDetail: "Este enlace de vinculación está destinado a la app iOS Backup Sandía.", appStore: "Obtener Backup Sandía"
});

const ptBR = pack({
  brand: "Backup Melancia", homepage: "Início", language: "Idioma", navOpen: "Abrir navegação", navPrivacy: "Privacidade", navPricing: "Preço", navFAQ: "Perguntas frequentes", navSpecs: "Especificações", navContact: "Contato", privacyPolicy: "Política de privacidade", footerNav: "Navegação do rodapé",
  eyebrow: "FAÇA BACKUP NESTE COMPUTADOR", title: "Seu computador é o destino.", intro: "Escolha uma pasta, escaneie uma vez com o iPhone e mantenha cada original no seu próprio computador.", local: "Transferência pela rede local", private: "As fotos não passam pela nuvem", temporary: "Conexão segura de uso único",
  panelTitle: "Conexão única pela rede local", panelIntro: "Mantenha esta página e o Backup Melancia abertos durante a transferência.", statusReady: "Pronto", statusPreparing: "Preparando", statusWaiting: "Aguardando", statusConnecting: "Conectando", statusDirect: "Direta", statusAction: "Ação necessária",
  chooseTitle: "Escolha uma pasta de backup", chooseDetail: "A página só pode acessar a pasta que você autorizar.", choose: "Escolher", change: "Alterar", connectTitle: "Criar uma conexão segura", connectDetail: "Conecte os dois dispositivos ao mesmo Wi-Fi. Desative a VPN se a conexão falhar.", connect: "Criar", preparing: "Preparando conexão segura…", waitingTitle: "Escaneie com o Backup Melancia", waitingDetail: "Abra o Backup Melancia no iPhone e escaneie este QR code.", expires: "Expira em", cancel: "Cancelar", connectingTitle: "Conectando diretamente…", connectingDetail: "Seus dispositivos estão negociando uma conexão WebRTC local.", connectedTitle: "Conexão local segura pronta", connectedDetail: "A sinalização terminou. Seus dispositivos estão conectados diretamente.",
  browserUnsupported: "Use a versão mais recente do Chrome ou Edge no macOS ou Windows.", secureContextRequired: "O acesso à pasta requer HTTPS ou localhost.", folderCancelled: "Nenhuma pasta foi selecionada.", connectionFailed: "Não foi possível criar a conexão segura. Tente novamente.", pairingExpired: "Esta conexão expirou. Crie uma nova.", directNote: "Se a conexão direta falhar, confirme que os dois dispositivos usam o mesmo Wi-Fi e desative a VPN.", handoffTitle: "Abra este link no Backup Melancia", handoffDetail: "Este link de conexão é destinado ao app iOS Backup Melancia.", appStore: "Obter Backup Melancia"
});

const ru = pack({
  brand: "Арбуз Backup", homepage: "Главная", language: "Язык", navOpen: "Открыть меню", navPrivacy: "Конфиденциальность", navPricing: "Цена", navFAQ: "Вопросы и ответы", navSpecs: "Параметры", navContact: "Контакты", privacyPolicy: "Политика конфиденциальности", footerNav: "Навигация внизу страницы",
  eyebrow: "РЕЗЕРВНАЯ КОПИЯ НА ЭТОТ КОМПЬЮТЕР", title: "Ваш компьютер — место назначения.", intro: "Выберите папку, один раз отсканируйте код с iPhone и храните все оригиналы на своём компьютере.", local: "Передача по локальной сети", private: "Фото не проходят через облако", temporary: "Одноразовое защищённое подключение",
  panelTitle: "Одноразовое подключение по локальной сети", panelIntro: "Во время передачи оставьте эту страницу и Арбуз Backup открытыми.", statusReady: "Готово", statusPreparing: "Подготовка", statusWaiting: "Ожидание", statusConnecting: "Подключение", statusDirect: "Напрямую", statusAction: "Требуется действие",
  chooseTitle: "Выберите папку для копии", chooseDetail: "Страница получит доступ только к разрешённой вами папке.", choose: "Выбрать", change: "Сменить", connectTitle: "Создайте защищённую ссылку", connectDetail: "Подключите оба устройства к одной сети Wi-Fi. Отключите VPN, если подключение не удаётся.", connect: "Создать", preparing: "Подготовка защищённой ссылки…", waitingTitle: "Сканируйте через Арбуз Backup", waitingDetail: "Откройте Арбуз Backup на iPhone и отсканируйте этот QR-код.", expires: "Истекает через", cancel: "Отмена", connectingTitle: "Прямое подключение…", connectingDetail: "Устройства согласовывают локальное WebRTC-подключение.", connectedTitle: "Защищённое локальное подключение готово", connectedDetail: "Обмен сигналами завершён. Устройства подключены напрямую.",
  browserUnsupported: "Используйте последнюю версию Chrome или Edge в macOS или Windows.", secureContextRequired: "Для доступа к папке требуется HTTPS или localhost.", folderCancelled: "Папка не выбрана.", connectionFailed: "Не удалось создать защищённую ссылку. Повторите попытку.", pairingExpired: "Срок действия ссылки истёк. Создайте новую.", directNote: "Если прямое подключение не удаётся, подключите оба устройства к одной сети Wi-Fi и отключите VPN.", handoffTitle: "Откройте эту ссылку в Арбуз Backup", handoffDetail: "Эта ссылка предназначена для iOS-приложения Арбуз Backup.", appStore: "Загрузить Арбуз Backup"
});

const uk = pack({
  brand: "Кавун Backup", homepage: "Головна", language: "Мова", navOpen: "Відкрити меню", navPrivacy: "Конфіденційність", navPricing: "Ціна", navFAQ: "Запитання й відповіді", navSpecs: "Параметри", navContact: "Контакти", privacyPolicy: "Політика конфіденційності", footerNav: "Навігація внизу сторінки",
  eyebrow: "РЕЗЕРВНА КОПІЯ НА ЦЕЙ КОМП’ЮТЕР", title: "Ваш комп’ютер — місце призначення.", intro: "Виберіть папку, один раз відскануйте код з iPhone і зберігайте всі оригінали на власному комп’ютері.", local: "Передавання локальною мережею", private: "Фото не проходять через хмару", temporary: "Одноразове захищене з’єднання",
  panelTitle: "Одноразове з’єднання локальною мережею", panelIntro: "Під час передавання залиште цю сторінку й Кавун Backup відкритими.", statusReady: "Готово", statusPreparing: "Підготовка", statusWaiting: "Очікування", statusConnecting: "Підключення", statusDirect: "Напряму", statusAction: "Потрібна дія",
  chooseTitle: "Виберіть папку для копії", chooseDetail: "Сторінка матиме доступ лише до дозволеної вами папки.", choose: "Вибрати", change: "Змінити", connectTitle: "Створіть захищене посилання", connectDetail: "Підключіть обидва пристрої до однієї мережі Wi-Fi. Вимкніть VPN, якщо з’єднання не вдається.", connect: "Створити", preparing: "Підготовка захищеного посилання…", waitingTitle: "Скануйте через Кавун Backup", waitingDetail: "Відкрийте Кавун Backup на iPhone і відскануйте цей QR-код.", expires: "Залишилося", cancel: "Скасувати", connectingTitle: "Пряме підключення…", connectingDetail: "Пристрої узгоджують локальне WebRTC-з’єднання.", connectedTitle: "Захищене локальне з’єднання готове", connectedDetail: "Обмін сигналами завершено. Пристрої з’єднані напряму.",
  browserUnsupported: "Використовуйте останню версію Chrome або Edge у macOS чи Windows.", secureContextRequired: "Для доступу до папки потрібен HTTPS або localhost.", folderCancelled: "Папку не вибрано.", connectionFailed: "Не вдалося створити захищене посилання. Спробуйте ще раз.", pairingExpired: "Термін дії посилання минув. Створіть нове.", directNote: "Якщо пряме підключення не працює, підключіть обидва пристрої до однієї мережі Wi-Fi та вимкніть VPN.", handoffTitle: "Відкрийте це посилання в Кавун Backup", handoffDetail: "Це посилання призначене для iOS-застосунку Кавун Backup.", appStore: "Завантажити Кавун Backup"
});

const messages: Record<Locale, Messages> = {
  en, "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko, de, fr, es, "es-419": es, "pt-BR": ptBR,
  "pt-PT": pack({ ...ptBR, navContact: "Contacto" }), ru, uk
};

export function resolveLocale(): Locale {
  const segment = location.pathname.split("/").filter(Boolean)[0];
  if (isLocale(segment)) return segment;
  const stored = localStorage.getItem("watermelon-link-locale");
  if (isLocale(stored)) return stored;
  const language = navigator.language.toLowerCase();
  if (language.includes("zh-tw") || language.includes("zh-hk") || language.includes("hant")) return "zh-Hant";
  if (language.startsWith("zh")) return "zh-Hans";
  if (language.startsWith("pt-br")) return "pt-BR";
  if (language.startsWith("pt")) return "pt-PT";
  if (language.startsWith("es-419")) return "es-419";
  const short = language.split("-")[0];
  return isLocale(short) ? short : "en";
}

export function localePath(locale: Locale): string {
  const pair = location.pathname.endsWith("/pair");
  if (locale === "en") return pair ? "/pair" : "/";
  return `/${locale}${pair ? "/pair" : "/"}`;
}

export function htmlLanguage(locale: Locale): string {
  if (locale === "zh-Hans") return "zh-CN";
  if (locale === "zh-Hant") return "zh-Hant";
  return locale;
}

export function translator(locale: Locale): (key: MessageKey) => string {
  return (key) => messages[locale][key];
}

function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && supportedLocales.includes(value as Locale);
}
