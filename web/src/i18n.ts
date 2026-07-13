export type Locale = "en" | "zh-Hans" | "zh-Hant" | "ja" | "ko" | "de" | "fr" | "es" | "es-419" | "pt-BR" | "pt-PT" | "ru" | "uk";

const supportedLocales: readonly Locale[] = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "fr", "es", "es-419", "pt-BR", "pt-PT", "ru", "uk"];

const en = {
  brand: "Watermelon Backup", homepage: "Homepage", language: "Language", navOpen: "Open navigation", navLink: "Link", navPrivacy: "Privacy", navPricing: "Pricing", navFAQ: "FAQ", navSpecs: "Specifications", navContact: "Contact", privacyPolicy: "Privacy Policy", footerNav: "Footer navigation",
  intro: "Choose a folder, scan once with your iPhone, and keep every original on your own computer.",
  panelTitle: "One-Time Connection over Your Local Network", panelIntro: "Watermelon Link works while this page and the Watermelon app stay open.", statusReady: "Ready", statusPreparing: "Preparing", statusWaiting: "Waiting", statusConnecting: "Connecting", statusDirect: "Direct", statusAction: "Action Needed",
  preflightTitle: "Check Browser", preflightCheck: "Start Check", preflightChecking: "Checking…", preflightReady: "Available", preflightRetry: "Try Again", localNetworkDenied: "Allow Local Network access for this site in your browser settings, then try again.", localNetworkUnavailable: "The browser WebRTC check failed. Reload this page and try again.",
  chooseTitle: "Choose a Backup Folder", chooseDetail: "The page can only access the folder you approve.", choose: "Choose", change: "Change", connectTitle: "Create a Secure Link", connectDetail: "Keep both devices on the same local network. Turn off VPN if connection fails.", singleWriterDetail: "Use this folder in only one Link at a time. Do not modify it during backup.", connect: "Create", preparing: "Preparing Secure Link…", waitingTitle: "Scan with Your iPhone", waitingDetail: "Scan with Camera, or from One-Time Connection in Watermelon Backup.", expires: "Expires in", cancel: "Cancel", disconnect: "Disconnect", connectingTitle: "Connecting Directly…", connectingDetail: "Your devices are negotiating a local WebRTC connection.", connectedTitle: "Ready to Back Up", connectedDetail: "Keep this page open, then choose photos and start the backup on your iPhone.",
  browserUnsupported: "Use the latest Chrome or Edge on macOS or Windows to choose a folder.", secureContextRequired: "Folder access requires HTTPS or localhost.", folderCancelled: "No folder was selected.", folderPermissionDenied: "Allow this site to access the folder, then try again.", folderSelectionFailed: "The folder could not be opened. Try again or choose another folder.", connectionFailed: "The secure link could not be created. Please try again.", browserNodeInUse: "Another tab is already using this browser node.", browserNodeCleanupPending: "A previous file operation is still closing. If this continues, reload this page.", peerDisconnected: "Your iPhone disconnected. Create a new link to reconnect.", pairingExpired: "This pairing link expired. Create a new one.", directNote: "If direct connection fails, check that both devices use the same local network and turn off VPN.", handoffTitle: "Open This Link in Watermelon Backup", handoffDetail: "This pairing link is intended for the Watermelon iOS app.", appStore: "Get Watermelon Backup"
} as const;

type Messages = { [Key in keyof typeof en]: string };
export type MessageKey = keyof Messages;
const pack = (overrides: Partial<Messages>): Messages => ({ ...en, ...overrides });

const zhHans = pack({
  brand: "西瓜备份", homepage: "官网", language: "语言", navOpen: "打开菜单", navPrivacy: "隐私", navPricing: "价格", navFAQ: "常见问题", navSpecs: "规格参数", navContact: "联系我们", privacyPolicy: "隐私政策", footerNav: "页脚导航",
  intro: "选择一个文件夹，用 iPhone 扫描一次，原片就保存在你自己的电脑里。",
  panelTitle: "通过局域网建立一次性连接", panelIntro: "传输期间请保持此页面和西瓜备份 App 打开。", statusReady: "就绪", statusPreparing: "准备中", statusWaiting: "等待扫描", statusConnecting: "连接中", statusDirect: "已直连", statusAction: "需要处理",
  chooseTitle: "选择备份文件夹", chooseDetail: "网页只能访问你明确授权的文件夹。", choose: "选择", change: "更换", connectTitle: "创建安全连接", connectDetail: "请确保两台设备位于同一局域网；如果连接失败，请关闭 VPN。", singleWriterDetail: "同一文件夹一次只能用于一个 Link；备份期间请勿在电脑上修改。", connect: "创建", preparing: "正在创建安全连接…", waitingTitle: "使用 iPhone 扫描", waitingDetail: "使用系统相机，或在西瓜备份的「一次性连接」中扫描此二维码。", expires: "剩余", cancel: "取消", disconnect: "断开连接", connectingTitle: "正在建立直连…", connectingDetail: "两台设备正在协商局域网 WebRTC 连接。", connectedTitle: "可以开始备份", connectedDetail: "请保持此页面打开，然后在 iPhone 上选择照片并开始备份。",
  browserUnsupported: "请在 macOS 或 Windows 使用最新版 Chrome 或 Edge 选择文件夹。", secureContextRequired: "文件夹访问需要 HTTPS 或 localhost。", folderCancelled: "没有选择文件夹。", connectionFailed: "无法创建安全连接，请重试。", pairingExpired: "配对连接已过期，请重新创建。", directNote: "如果无法直连，请确认两台设备位于同一局域网，并关闭 VPN。", handoffTitle: "请使用西瓜备份打开此连接", handoffDetail: "这个配对链接需要交给西瓜备份 iOS App。", appStore: "获取西瓜备份"
});

const zhHant = pack({
  brand: "西瓜備份", homepage: "官網", language: "語言", navOpen: "開啟選單", navPrivacy: "隱私", navPricing: "價格", navFAQ: "常見問題", navSpecs: "規格參數", navContact: "聯絡我們", privacyPolicy: "隱私權政策", footerNav: "頁尾導覽",
  intro: "選擇一個資料夾，用 iPhone 掃描一次，原始檔案就保存在你自己的電腦裡。",
  panelTitle: "透過區域網路建立一次性連線", panelIntro: "傳輸期間請保持此頁面和西瓜備份 App 開啟。", statusReady: "就緒", statusPreparing: "準備中", statusWaiting: "等待掃描", statusConnecting: "連線中", statusDirect: "已直連", statusAction: "需要處理",
  chooseTitle: "選擇備份資料夾", chooseDetail: "網頁只能存取你明確授權的資料夾。", choose: "選擇", change: "更換", connectTitle: "建立安全連線", connectDetail: "請確保兩台裝置位於同一區域網路；如果連線失敗，請關閉 VPN。", singleWriterDetail: "同一資料夾一次只能用於一個 Link；備份期間請勿在電腦上修改。", connect: "建立", preparing: "正在建立安全連線…", waitingTitle: "使用 iPhone 掃描", waitingDetail: "使用系統相機，或在西瓜備份的「一次性連線」中掃描此 QR Code。", expires: "剩餘", cancel: "取消", disconnect: "中斷連線", connectingTitle: "正在建立直連…", connectingDetail: "兩台裝置正在協商區域網路 WebRTC 連線。", connectedTitle: "可以開始備份", connectedDetail: "請保持此頁面開啟，然後在 iPhone 上選擇相片並開始備份。",
  browserUnsupported: "請在 macOS 或 Windows 使用最新版 Chrome 或 Edge 選擇資料夾。", secureContextRequired: "資料夾存取需要 HTTPS 或 localhost。", folderCancelled: "沒有選擇資料夾。", connectionFailed: "無法建立安全連線，請重試。", pairingExpired: "配對連線已過期，請重新建立。", directNote: "如果無法直連，請確認兩台裝置位於同一區域網路，並關閉 VPN。", handoffTitle: "請使用西瓜備份開啟此連線", handoffDetail: "這個配對連結需要交給西瓜備份 iOS App。", appStore: "取得西瓜備份"
});

const ja = pack({
  brand: "スイカバックアップ", homepage: "ホームページ", language: "言語", navOpen: "ナビゲーションを開く", navPrivacy: "プライバシー", navPricing: "価格", navFAQ: "FAQ", navSpecs: "仕様", navContact: "お問い合わせ", privacyPolicy: "プライバシーポリシー", footerNav: "フッターのナビゲーション",
  intro: "フォルダを選び、iPhoneで一度スキャンするだけ。オリジナルは自分のコンピュータに保存されます。",
  panelTitle: "ローカルネットワークで一回限りの接続", panelIntro: "転送中はこのページとスイカバックアップを開いたままにしてください。", statusReady: "準備完了", statusPreparing: "準備中", statusWaiting: "スキャン待ち", statusConnecting: "接続中", statusDirect: "直接接続", statusAction: "確認が必要",
  chooseTitle: "バックアップフォルダを選択", chooseDetail: "このページは許可したフォルダだけにアクセスできます。", choose: "選択", change: "変更", connectTitle: "安全なリンクを作成", connectDetail: "両方のデバイスを同じローカルネットワークに接続してください。接続できない場合はVPNをオフにしてください。", connect: "作成", preparing: "安全なリンクを準備中…", waitingTitle: "iPhoneでスキャン", waitingDetail: "カメラ、またはスイカバックアップの「一回限りの接続」からスキャンしてください。", expires: "有効期限", cancel: "キャンセル", disconnect: "接続を解除", connectingTitle: "直接接続中…", connectingDetail: "デバイス間でローカルWebRTC接続を確立しています。", connectedTitle: "バックアップを開始できます", connectedDetail: "このページを開いたまま、iPhoneで写真を選んでバックアップを開始してください。",
  browserUnsupported: "macOSまたはWindowsの最新のChromeかEdgeでフォルダを選択してください。", secureContextRequired: "フォルダへのアクセスにはHTTPSまたはlocalhostが必要です。", folderCancelled: "フォルダが選択されていません。", connectionFailed: "安全なリンクを作成できませんでした。もう一度お試しください。", pairingExpired: "ペアリングリンクの期限が切れました。新しく作成してください。", directNote: "直接接続できない場合は、両方のデバイスが同じローカルネットワークにあり、VPNがオフになっていることを確認してください。", handoffTitle: "スイカバックアップでこのリンクを開く", handoffDetail: "このペアリングリンクはスイカバックアップiOSアプリ用です。", appStore: "スイカバックアップを入手"
});

const ko = pack({
  brand: "수박 백업", homepage: "홈페이지", language: "언어", navOpen: "내비게이션 열기", navPrivacy: "개인정보", navPricing: "가격", navFAQ: "FAQ", navSpecs: "사양", navContact: "문의하기", privacyPolicy: "개인정보 처리방침", footerNav: "푸터 내비게이션",
  intro: "폴더를 선택하고 iPhone으로 한 번 스캔하면 원본이 내 컴퓨터에 저장됩니다.",
  panelTitle: "로컬 네트워크에서 일회용 연결", panelIntro: "전송 중에는 이 페이지와 수박 백업 앱을 열어 두세요.", statusReady: "준비됨", statusPreparing: "준비 중", statusWaiting: "스캔 대기", statusConnecting: "연결 중", statusDirect: "직접 연결", statusAction: "확인 필요",
  chooseTitle: "백업 폴더 선택", chooseDetail: "이 페이지는 사용자가 허용한 폴더에만 접근할 수 있습니다.", choose: "선택", change: "변경", connectTitle: "보안 링크 만들기", connectDetail: "두 기기를 같은 로컬 네트워크에 연결하세요. 연결되지 않으면 VPN을 끄세요.", connect: "만들기", preparing: "보안 링크 준비 중…", waitingTitle: "iPhone으로 스캔", waitingDetail: "카메라 또는 수박 백업의 일회성 연결에서 스캔하세요.", expires: "남은 시간", cancel: "취소", disconnect: "연결 해제", connectingTitle: "직접 연결 중…", connectingDetail: "두 기기가 로컬 WebRTC 연결을 협상하고 있습니다.", connectedTitle: "백업 준비 완료", connectedDetail: "이 페이지를 열어 둔 채 iPhone에서 사진을 선택하고 백업을 시작하세요.",
  browserUnsupported: "macOS 또는 Windows에서 최신 Chrome이나 Edge로 폴더를 선택하세요.", secureContextRequired: "폴더 접근에는 HTTPS 또는 localhost가 필요합니다.", folderCancelled: "폴더를 선택하지 않았습니다.", connectionFailed: "보안 링크를 만들 수 없습니다. 다시 시도하세요.", pairingExpired: "페어링 링크가 만료되었습니다. 새로 만드세요.", directNote: "직접 연결되지 않으면 두 기기가 같은 로컬 네트워크에 있고 VPN이 꺼져 있는지 확인하세요.", handoffTitle: "수박 백업에서 이 링크 열기", handoffDetail: "이 페어링 링크는 수박 백업 iOS 앱용입니다.", appStore: "수박 백업 받기"
});

const de = pack({
  brand: "Melon Backup", homepage: "Startseite", language: "Sprache", navOpen: "Navigation öffnen", navPrivacy: "Datenschutz", navPricing: "Preise", navFAQ: "FAQ", navSpecs: "Technische Daten", navContact: "Kontakt", privacyPolicy: "Datenschutzerklärung", footerNav: "Navigation im Footer",
  intro: "Wählen Sie einen Ordner, scannen Sie einmal mit dem iPhone und speichern Sie jedes Original auf Ihrem eigenen Computer.",
  panelTitle: "Einmalige Verbindung im lokalen Netzwerk", panelIntro: "Lassen Sie diese Seite und Melon Backup während der Übertragung geöffnet.", statusReady: "Bereit", statusPreparing: "Vorbereitung", statusWaiting: "Warten", statusConnecting: "Verbinden", statusDirect: "Direkt", statusAction: "Aktion erforderlich",
  chooseTitle: "Sicherungsordner auswählen", chooseDetail: "Die Seite kann nur auf den von Ihnen freigegebenen Ordner zugreifen.", choose: "Auswählen", change: "Ändern", connectTitle: "Sichere Verbindung erstellen", connectDetail: "Verbinden Sie beide Geräte mit demselben lokalen Netzwerk. Deaktivieren Sie VPN, falls die Verbindung fehlschlägt.", connect: "Erstellen", preparing: "Sichere Verbindung wird vorbereitet…", waitingTitle: "Mit dem iPhone scannen", waitingDetail: "Scannen Sie mit der Kamera oder über „Einmalige Verbindung“ in Melon Backup.", expires: "Läuft ab in", cancel: "Abbrechen", disconnect: "Verbindung trennen", connectingTitle: "Direkte Verbindung wird hergestellt…", connectingDetail: "Ihre Geräte handeln eine lokale WebRTC-Verbindung aus.", connectedTitle: "Bereit zum Sichern", connectedDetail: "Lassen Sie diese Seite geöffnet, wählen Sie dann auf Ihrem iPhone Fotos aus und starten Sie die Sicherung.",
  browserUnsupported: "Verwenden Sie die aktuelle Version von Chrome oder Edge unter macOS oder Windows.", secureContextRequired: "Der Ordnerzugriff erfordert HTTPS oder localhost.", folderCancelled: "Es wurde kein Ordner ausgewählt.", connectionFailed: "Die sichere Verbindung konnte nicht erstellt werden. Versuchen Sie es erneut.", pairingExpired: "Diese Kopplung ist abgelaufen. Erstellen Sie eine neue.", directNote: "Wenn die direkte Verbindung fehlschlägt, verbinden Sie beide Geräte mit demselben lokalen Netzwerk und deaktivieren Sie VPN.", handoffTitle: "Diesen Link in Melon Backup öffnen", handoffDetail: "Dieser Kopplungslink ist für die Melon Backup iOS-App bestimmt.", appStore: "Melon Backup laden"
});

const fr = pack({
  brand: "Melon Backup", homepage: "Accueil", language: "Langue", navOpen: "Ouvrir la navigation", navPrivacy: "Confidentialité", navPricing: "Tarifs", navFAQ: "FAQ", navSpecs: "Spécifications", navContact: "Contact", privacyPolicy: "Politique de confidentialité", footerNav: "Navigation du pied de page",
  intro: "Choisissez un dossier, scannez une fois avec votre iPhone et conservez chaque original sur votre ordinateur.",
  panelTitle: "Connexion unique sur votre réseau local", panelIntro: "Gardez cette page et Melon Backup ouverts pendant le transfert.", statusReady: "Prêt", statusPreparing: "Préparation", statusWaiting: "En attente", statusConnecting: "Connexion", statusDirect: "Direct", statusAction: "Action requise",
  chooseTitle: "Choisir un dossier de sauvegarde", chooseDetail: "La page ne peut accéder qu’au dossier que vous autorisez.", choose: "Choisir", change: "Modifier", connectTitle: "Créer un lien sécurisé", connectDetail: "Connectez les deux appareils au même réseau local. Désactivez le VPN si la connexion échoue.", connect: "Créer", preparing: "Préparation du lien sécurisé…", waitingTitle: "Scanner avec votre iPhone", waitingDetail: "Scannez avec l’appareil photo ou depuis Connexion à usage unique dans Melon Backup.", expires: "Expire dans", cancel: "Annuler", disconnect: "Déconnecter", connectingTitle: "Connexion directe…", connectingDetail: "Vos appareils négocient une connexion WebRTC locale.", connectedTitle: "Prêt pour la sauvegarde", connectedDetail: "Gardez cette page ouverte, puis choisissez des photos sur votre iPhone et lancez la sauvegarde.",
  browserUnsupported: "Utilisez la dernière version de Chrome ou Edge sur macOS ou Windows.", secureContextRequired: "L’accès au dossier nécessite HTTPS ou localhost.", folderCancelled: "Aucun dossier n’a été sélectionné.", connectionFailed: "Le lien sécurisé n’a pas pu être créé. Réessayez.", pairingExpired: "Ce lien d’association a expiré. Créez-en un nouveau.", directNote: "Si la connexion directe échoue, vérifiez que les deux appareils utilisent le même réseau local et désactivez le VPN.", handoffTitle: "Ouvrir ce lien dans Melon Backup", handoffDetail: "Ce lien d’association est destiné à l’app iOS Melon Backup.", appStore: "Obtenir Melon Backup"
});

const es = pack({
  brand: "Backup Sandía", homepage: "Inicio", language: "Idioma", navOpen: "Abrir navegación", navPrivacy: "Privacidad", navPricing: "Precio", navFAQ: "Preguntas frecuentes", navSpecs: "Especificaciones", navContact: "Contacto", privacyPolicy: "Política de privacidad", footerNav: "Navegación del pie de página",
  intro: "Elige una carpeta, escanea una vez con el iPhone y conserva cada original en tu propio ordenador.",
  panelTitle: "Conexión única en tu red local", panelIntro: "Mantén esta página y Backup Sandía abiertos durante la transferencia.", statusReady: "Listo", statusPreparing: "Preparando", statusWaiting: "Esperando", statusConnecting: "Conectando", statusDirect: "Directa", statusAction: "Requiere atención",
  chooseTitle: "Elige una carpeta de copia", chooseDetail: "La página solo puede acceder a la carpeta que autorices.", choose: "Elegir", change: "Cambiar", connectTitle: "Crear un enlace seguro", connectDetail: "Conecta ambos dispositivos a la misma red local. Desactiva la VPN si falla la conexión.", connect: "Crear", preparing: "Preparando el enlace seguro…", waitingTitle: "Escanea con tu iPhone", waitingDetail: "Escanea con la cámara o desde Conexión de un solo uso en Backup Sandía.", expires: "Caduca en", cancel: "Cancelar", disconnect: "Desconectar", connectingTitle: "Conectando directamente…", connectingDetail: "Tus dispositivos están negociando una conexión WebRTC local.", connectedTitle: "Listo para hacer la copia", connectedDetail: "Mantén esta página abierta, elige fotos en el iPhone e inicia la copia.",
  browserUnsupported: "Usa la última versión de Chrome o Edge en macOS o Windows.", secureContextRequired: "El acceso a carpetas requiere HTTPS o localhost.", folderCancelled: "No se seleccionó ninguna carpeta.", connectionFailed: "No se pudo crear el enlace seguro. Inténtalo de nuevo.", pairingExpired: "Este enlace de vinculación caducó. Crea uno nuevo.", directNote: "Si falla la conexión directa, comprueba que ambos dispositivos usan la misma red local y desactiva la VPN.", handoffTitle: "Abre este enlace en Backup Sandía", handoffDetail: "Este enlace de vinculación está destinado a la app iOS Backup Sandía.", appStore: "Obtener Backup Sandía"
});

const ptBR = pack({
  brand: "Backup Melancia", homepage: "Início", language: "Idioma", navOpen: "Abrir navegação", navPrivacy: "Privacidade", navPricing: "Preço", navFAQ: "Perguntas frequentes", navSpecs: "Especificações", navContact: "Contato", privacyPolicy: "Política de privacidade", footerNav: "Navegação do rodapé",
  intro: "Escolha uma pasta, escaneie uma vez com o iPhone e mantenha cada original no seu próprio computador.",
  panelTitle: "Conexão única pela rede local", panelIntro: "Mantenha esta página e o Backup Melancia abertos durante a transferência.", statusReady: "Pronto", statusPreparing: "Preparando", statusWaiting: "Aguardando", statusConnecting: "Conectando", statusDirect: "Direta", statusAction: "Ação necessária",
  chooseTitle: "Escolha uma pasta de backup", chooseDetail: "A página só pode acessar a pasta que você autorizar.", choose: "Escolher", change: "Alterar", connectTitle: "Criar uma conexão segura", connectDetail: "Conecte os dois dispositivos à mesma rede local. Desative a VPN se a conexão falhar.", connect: "Criar", preparing: "Preparando conexão segura…", waitingTitle: "Escaneie com o iPhone", waitingDetail: "Escaneie com a câmera ou pela Conexão de uso único no Backup Melancia.", expires: "Expira em", cancel: "Cancelar", disconnect: "Desconectar", connectingTitle: "Conectando diretamente…", connectingDetail: "Seus dispositivos estão negociando uma conexão WebRTC local.", connectedTitle: "Pronto para fazer backup", connectedDetail: "Mantenha esta página aberta, selecione fotos no iPhone e inicie o backup.",
  browserUnsupported: "Use a versão mais recente do Chrome ou Edge no macOS ou Windows.", secureContextRequired: "O acesso à pasta requer HTTPS ou localhost.", folderCancelled: "Nenhuma pasta foi selecionada.", connectionFailed: "Não foi possível criar a conexão segura. Tente novamente.", pairingExpired: "Esta conexão expirou. Crie uma nova.", directNote: "Se a conexão direta falhar, confirme que os dois dispositivos usam a mesma rede local e desative a VPN.", handoffTitle: "Abra este link no Backup Melancia", handoffDetail: "Este link de conexão é destinado ao app iOS Backup Melancia.", appStore: "Obter Backup Melancia"
});

const ru = pack({
  brand: "Арбуз Backup", homepage: "Главная", language: "Язык", navOpen: "Открыть меню", navPrivacy: "Конфиденциальность", navPricing: "Цена", navFAQ: "Вопросы и ответы", navSpecs: "Параметры", navContact: "Контакты", privacyPolicy: "Политика конфиденциальности", footerNav: "Навигация внизу страницы",
  intro: "Выберите папку, один раз отсканируйте код с iPhone и храните все оригиналы на своём компьютере.",
  panelTitle: "Одноразовое подключение по локальной сети", panelIntro: "Во время передачи оставьте эту страницу и Арбуз Backup открытыми.", statusReady: "Готово", statusPreparing: "Подготовка", statusWaiting: "Ожидание", statusConnecting: "Подключение", statusDirect: "Напрямую", statusAction: "Требуется действие",
  chooseTitle: "Выберите папку для копии", chooseDetail: "Страница получит доступ только к разрешённой вами папке.", choose: "Выбрать", change: "Сменить", connectTitle: "Создайте защищённую ссылку", connectDetail: "Подключите оба устройства к одной локальной сети. Отключите VPN, если подключение не удаётся.", connect: "Создать", preparing: "Подготовка защищённой ссылки…", waitingTitle: "Сканируйте с помощью iPhone", waitingDetail: "Используйте камеру или раздел «Одноразовое подключение» в приложении Арбуз Backup.", expires: "Истекает через", cancel: "Отмена", disconnect: "Отключиться", connectingTitle: "Прямое подключение…", connectingDetail: "Устройства согласовывают локальное WebRTC-подключение.", connectedTitle: "Готово к резервному копированию", connectedDetail: "Не закрывайте эту страницу, затем выберите фотографии на iPhone и запустите резервное копирование.",
  browserUnsupported: "Используйте последнюю версию Chrome или Edge в macOS или Windows.", secureContextRequired: "Для доступа к папке требуется HTTPS или localhost.", folderCancelled: "Папка не выбрана.", connectionFailed: "Не удалось создать защищённую ссылку. Повторите попытку.", pairingExpired: "Срок действия ссылки истёк. Создайте новую.", directNote: "Если прямое подключение не удаётся, подключите оба устройства к одной локальной сети и отключите VPN.", handoffTitle: "Откройте эту ссылку в Арбуз Backup", handoffDetail: "Эта ссылка предназначена для iOS-приложения Арбуз Backup.", appStore: "Загрузить Арбуз Backup"
});

const uk = pack({
  brand: "Кавун Backup", homepage: "Головна", language: "Мова", navOpen: "Відкрити меню", navPrivacy: "Конфіденційність", navPricing: "Ціна", navFAQ: "Запитання й відповіді", navSpecs: "Параметри", navContact: "Контакти", privacyPolicy: "Політика конфіденційності", footerNav: "Навігація внизу сторінки",
  intro: "Виберіть папку, один раз відскануйте код з iPhone і зберігайте всі оригінали на власному комп’ютері.",
  panelTitle: "Одноразове з’єднання локальною мережею", panelIntro: "Під час передавання залиште цю сторінку й Кавун Backup відкритими.", statusReady: "Готово", statusPreparing: "Підготовка", statusWaiting: "Очікування", statusConnecting: "Підключення", statusDirect: "Напряму", statusAction: "Потрібна дія",
  chooseTitle: "Виберіть папку для копії", chooseDetail: "Сторінка матиме доступ лише до дозволеної вами папки.", choose: "Вибрати", change: "Змінити", connectTitle: "Створіть захищене посилання", connectDetail: "Підключіть обидва пристрої до однієї локальної мережі. Вимкніть VPN, якщо з’єднання не вдається.", connect: "Створити", preparing: "Підготовка захищеного посилання…", waitingTitle: "Скануйте за допомогою iPhone", waitingDetail: "Скористайтеся камерою або розділом «Одноразове підключення» у застосунку Кавун Backup.", expires: "Залишилося", cancel: "Скасувати", disconnect: "Від’єднатися", connectingTitle: "Пряме підключення…", connectingDetail: "Пристрої узгоджують локальне WebRTC-з’єднання.", connectedTitle: "Готово до резервного копіювання", connectedDetail: "Не закривайте цю сторінку, потім виберіть фотографії на iPhone і почніть резервне копіювання.",
  browserUnsupported: "Використовуйте останню версію Chrome або Edge у macOS чи Windows.", secureContextRequired: "Для доступу до папки потрібен HTTPS або localhost.", folderCancelled: "Папку не вибрано.", connectionFailed: "Не вдалося створити захищене посилання. Спробуйте ще раз.", pairingExpired: "Термін дії посилання минув. Створіть нове.", directNote: "Якщо пряме підключення не працює, підключіть обидва пристрої до однієї локальної мережі та вимкніть VPN.", handoffTitle: "Відкрийте це посилання в Кавун Backup", handoffDetail: "Це посилання призначене для iOS-застосунку Кавун Backup.", appStore: "Завантажити Кавун Backup"
});

const messages: Record<Locale, Messages> = {
  en, "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko, de, fr, es, "es-419": es, "pt-BR": ptBR,
  "pt-PT": pack({
    ...ptBR,
    navContact: "Contacto",
    connectedTitle: "Pronto para a cópia",
    connectedDetail: "Mantenha esta página aberta, selecione fotografias no iPhone e inicie a cópia."
  }),
  ru, uk
};

const singleWriterDetails: Record<Locale, string> = {
  en: en.singleWriterDetail,
  "zh-Hans": zhHans.singleWriterDetail,
  "zh-Hant": zhHant.singleWriterDetail,
  ja: "このフォルダは一度に1つのLinkだけで使用し、バックアップ中は変更しないでください。",
  ko: "이 폴더는 한 번에 하나의 Link에서만 사용하고 백업 중에는 수정하지 마세요.",
  de: "Verwenden Sie diesen Ordner nur in einem Link gleichzeitig und ändern Sie ihn während der Sicherung nicht.",
  fr: "N’utilisez ce dossier que dans un seul Link à la fois et ne le modifiez pas pendant la sauvegarde.",
  es: "Usa esta carpeta en un solo Link a la vez y no la modifiques durante la copia.",
  "es-419": "Usa esta carpeta en un solo Link a la vez y no la modifiques durante la copia.",
  "pt-BR": "Use esta pasta em apenas um Link por vez e não a altere durante o backup.",
  "pt-PT": "Utilize esta pasta apenas num Link de cada vez e não a altere durante a cópia.",
  ru: "Используйте эту папку только в одном Link и не изменяйте её во время копирования.",
  uk: "Використовуйте цю папку лише в одному Link і не змінюйте її під час копіювання."
};

const peerDisconnectedMessages: Record<Locale, string> = {
  en: en.peerDisconnected,
  "zh-Hans": "iPhone 已断开连接，请重新创建 Link。",
  "zh-Hant": "iPhone 已中斷連線，請重新建立 Link。",
  ja: "iPhoneとの接続が切れました。新しいリンクを作成して再接続してください。",
  ko: "iPhone 연결이 끊어졌습니다. 새 링크를 만들어 다시 연결하세요.",
  de: "Die Verbindung zum iPhone wurde getrennt. Erstellen Sie zum erneuten Verbinden einen neuen Link.",
  fr: "L’iPhone s’est déconnecté. Créez un nouveau lien pour vous reconnecter.",
  es: "El iPhone se desconectó. Crea un nuevo enlace para volver a conectarlo.",
  "es-419": "El iPhone se desconectó. Crea un nuevo enlace para volver a conectarlo.",
  "pt-BR": "O iPhone foi desconectado. Crie um novo link para reconectar.",
  "pt-PT": "O iPhone desligou-se. Crie uma nova ligação para voltar a ligar.",
  ru: "iPhone отключился. Создайте новую ссылку для повторного подключения.",
  uk: "iPhone від’єднався. Створіть нове посилання, щоб підключитися знову."
};

const browserNodeInUseMessages: Record<Locale, string> = {
  en: en.browserNodeInUse,
  "zh-Hans": "另一个标签页正在使用此浏览器节点。",
  "zh-Hant": "另一個分頁正在使用此瀏覽器節點。",
  ja: "別のタブがこのブラウザノードを使用しています。",
  ko: "다른 탭에서 이 브라우저 노드를 사용 중입니다.",
  de: "Ein anderer Tab verwendet diesen Browserknoten bereits.",
  fr: "Un autre onglet utilise déjà ce nœud de navigateur.",
  es: "Otra pestaña ya está usando este nodo del navegador.",
  "es-419": "Otra pestaña ya está usando este nodo del navegador.",
  "pt-BR": "Outra aba já está usando este nó do navegador.",
  "pt-PT": "Outro separador já está a utilizar este nó do navegador.",
  ru: "Этот узел браузера уже используется в другой вкладке.",
  uk: "Цей вузол браузера вже використовується в іншій вкладці."
};

const browserNodeCleanupPendingMessages: Record<Locale, string> = {
  en: en.browserNodeCleanupPending,
  "zh-Hans": "上一次文件操作仍在关闭；如果长时间没有结束，请重新加载此页面。",
  "zh-Hant": "上一次檔案操作仍在關閉；如果長時間沒有結束，請重新載入此頁面。",
  ja: "前回のファイル操作を終了しています。終わらない場合は、このページを再読み込みしてください。",
  ko: "이전 파일 작업을 종료하는 중입니다. 계속되면 이 페이지를 새로고침하세요.",
  de: "Ein vorheriger Dateivorgang wird noch beendet. Laden Sie diese Seite neu, falls dies länger dauert.",
  fr: "Une opération de fichier précédente est toujours en cours de fermeture. Si cela persiste, rechargez cette page.",
  es: "Una operación de archivo anterior aún se está cerrando. Si continúa, vuelve a cargar esta página.",
  "es-419": "Una operación de archivo anterior aún se está cerrando. Si continúa, vuelve a cargar esta página.",
  "pt-BR": "Uma operação de arquivo anterior ainda está sendo encerrada. Se isso continuar, recarregue esta página.",
  "pt-PT": "Uma operação de ficheiro anterior ainda está a terminar. Se isto continuar, recarregue esta página.",
  ru: "Предыдущая файловая операция ещё завершается. Если это продолжается, перезагрузите страницу.",
  uk: "Попередня файлова операція ще завершується. Якщо це триває, перезавантажте сторінку."
};

type PreflightMessageKey = "preflightTitle" | "preflightCheck" | "preflightChecking" | "preflightReady" | "preflightRetry" | "localNetworkDenied" | "localNetworkUnavailable";

const preflightMessages: Record<Locale, Pick<Messages, PreflightMessageKey>> = {
  en: { preflightTitle: en.preflightTitle, preflightCheck: en.preflightCheck, preflightChecking: en.preflightChecking, preflightReady: en.preflightReady, preflightRetry: en.preflightRetry, localNetworkDenied: en.localNetworkDenied, localNetworkUnavailable: en.localNetworkUnavailable },
  "zh-Hans": { preflightTitle: "检查浏览器", preflightCheck: "开始检查", preflightChecking: "检查中…", preflightReady: "可用", preflightRetry: "重试", localNetworkDenied: "请在浏览器设置中允许本站访问本地网络，然后重试。", localNetworkUnavailable: "浏览器 WebRTC 检查失败，请重新加载页面后重试。" },
  "zh-Hant": { preflightTitle: "檢查瀏覽器", preflightCheck: "開始檢查", preflightChecking: "檢查中…", preflightReady: "可用", preflightRetry: "重試", localNetworkDenied: "請在瀏覽器設定中允許本站存取本地網路，然後重試。", localNetworkUnavailable: "瀏覽器 WebRTC 檢查失敗，請重新載入頁面後再試。" },
  ja: { preflightTitle: "ブラウザを確認", preflightCheck: "確認を開始", preflightChecking: "確認中…", preflightReady: "利用可能", preflightRetry: "再試行", localNetworkDenied: "ブラウザの設定でこのサイトのローカルネットワークアクセスを許可して、もう一度お試しください。", localNetworkUnavailable: "ブラウザのWebRTCチェックに失敗しました。ページを再読み込みしてお試しください。" },
  ko: { preflightTitle: "브라우저 확인", preflightCheck: "확인 시작", preflightChecking: "확인 중…", preflightReady: "사용 가능", preflightRetry: "다시 시도", localNetworkDenied: "브라우저 설정에서 이 사이트의 로컬 네트워크 접근을 허용한 후 다시 시도하세요.", localNetworkUnavailable: "브라우저 WebRTC 확인에 실패했습니다. 페이지를 새로고침한 후 다시 시도하세요." },
  de: { preflightTitle: "Browser prüfen", preflightCheck: "Prüfung starten", preflightChecking: "Prüfung…", preflightReady: "Verfügbar", preflightRetry: "Erneut versuchen", localNetworkDenied: "Erlauben Sie dieser Website in den Browsereinstellungen den Zugriff auf das lokale Netzwerk und versuchen Sie es erneut.", localNetworkUnavailable: "Die WebRTC-Prüfung des Browsers ist fehlgeschlagen. Laden Sie die Seite neu und versuchen Sie es erneut." },
  fr: { preflightTitle: "Vérifier le navigateur", preflightCheck: "Lancer la vérification", preflightChecking: "Vérification…", preflightReady: "Disponible", preflightRetry: "Réessayer", localNetworkDenied: "Autorisez ce site à accéder au réseau local dans les réglages du navigateur, puis réessayez.", localNetworkUnavailable: "La vérification WebRTC du navigateur a échoué. Rechargez la page et réessayez." },
  es: { preflightTitle: "Comprobar navegador", preflightCheck: "Iniciar comprobación", preflightChecking: "Comprobando…", preflightReady: "Disponible", preflightRetry: "Reintentar", localNetworkDenied: "Permite que este sitio acceda a la red local en los ajustes del navegador y vuelve a intentarlo.", localNetworkUnavailable: "La comprobación WebRTC del navegador falló. Recarga la página e inténtalo de nuevo." },
  "es-419": { preflightTitle: "Comprobar navegador", preflightCheck: "Iniciar comprobación", preflightChecking: "Comprobando…", preflightReady: "Disponible", preflightRetry: "Reintentar", localNetworkDenied: "Permite que este sitio acceda a la red local en la configuración del navegador y vuelve a intentarlo.", localNetworkUnavailable: "La comprobación WebRTC del navegador falló. Recarga la página e inténtalo de nuevo." },
  "pt-BR": { preflightTitle: "Verificar navegador", preflightCheck: "Iniciar verificação", preflightChecking: "Verificando…", preflightReady: "Disponível", preflightRetry: "Tentar novamente", localNetworkDenied: "Permita que este site acesse a rede local nas configurações do navegador e tente novamente.", localNetworkUnavailable: "A verificação WebRTC do navegador falhou. Recarregue a página e tente novamente." },
  "pt-PT": { preflightTitle: "Verificar o navegador", preflightCheck: "Iniciar verificação", preflightChecking: "A verificar…", preflightReady: "Disponível", preflightRetry: "Tentar novamente", localNetworkDenied: "Permita que este site aceda à rede local nas definições do navegador e tente novamente.", localNetworkUnavailable: "A verificação WebRTC do navegador falhou. Recarregue a página e tente novamente." },
  ru: { preflightTitle: "Проверить браузер", preflightCheck: "Начать проверку", preflightChecking: "Проверка…", preflightReady: "Доступно", preflightRetry: "Повторить", localNetworkDenied: "Разрешите этому сайту доступ к локальной сети в настройках браузера и повторите попытку.", localNetworkUnavailable: "Проверка WebRTC в браузере не пройдена. Перезагрузите страницу и повторите попытку." },
  uk: { preflightTitle: "Перевірити браузер", preflightCheck: "Почати перевірку", preflightChecking: "Перевірка…", preflightReady: "Доступно", preflightRetry: "Повторити", localNetworkDenied: "Дозвольте цьому сайту доступ до локальної мережі в налаштуваннях браузера та повторіть спробу.", localNetworkUnavailable: "Перевірка WebRTC у браузері не пройшла. Перезавантажте сторінку та повторіть спробу." }
};

type FolderErrorMessageKey = "folderPermissionDenied" | "folderSelectionFailed";

const folderErrorMessages: Record<Locale, Pick<Messages, FolderErrorMessageKey>> = {
  en: { folderPermissionDenied: en.folderPermissionDenied, folderSelectionFailed: en.folderSelectionFailed },
  "zh-Hans": { folderPermissionDenied: "请允许本站访问该文件夹，然后重试。", folderSelectionFailed: "无法打开这个文件夹，请重试或选择其他文件夹。" },
  "zh-Hant": { folderPermissionDenied: "請允許本站存取該資料夾，然後重試。", folderSelectionFailed: "無法開啟這個資料夾，請重試或選擇其他資料夾。" },
  ja: { folderPermissionDenied: "このサイトのフォルダアクセスを許可して、もう一度お試しください。", folderSelectionFailed: "フォルダを開けませんでした。再試行するか、別のフォルダを選択してください。" },
  ko: { folderPermissionDenied: "이 사이트의 폴더 접근을 허용한 후 다시 시도하세요.", folderSelectionFailed: "폴더를 열 수 없습니다. 다시 시도하거나 다른 폴더를 선택하세요." },
  de: { folderPermissionDenied: "Erlauben Sie dieser Website den Zugriff auf den Ordner und versuchen Sie es erneut.", folderSelectionFailed: "Der Ordner konnte nicht geöffnet werden. Versuchen Sie es erneut oder wählen Sie einen anderen Ordner." },
  fr: { folderPermissionDenied: "Autorisez ce site à accéder au dossier, puis réessayez.", folderSelectionFailed: "Impossible d’ouvrir le dossier. Réessayez ou choisissez-en un autre." },
  es: { folderPermissionDenied: "Permite que este sitio acceda a la carpeta y vuelve a intentarlo.", folderSelectionFailed: "No se pudo abrir la carpeta. Inténtalo de nuevo o elige otra." },
  "es-419": { folderPermissionDenied: "Permite que este sitio acceda a la carpeta y vuelve a intentarlo.", folderSelectionFailed: "No se pudo abrir la carpeta. Inténtalo de nuevo o elige otra." },
  "pt-BR": { folderPermissionDenied: "Permita que este site acesse a pasta e tente novamente.", folderSelectionFailed: "Não foi possível abrir a pasta. Tente novamente ou escolha outra pasta." },
  "pt-PT": { folderPermissionDenied: "Permita que este site aceda à pasta e tente novamente.", folderSelectionFailed: "Não foi possível abrir a pasta. Tente novamente ou escolha outra pasta." },
  ru: { folderPermissionDenied: "Разрешите этому сайту доступ к папке и повторите попытку.", folderSelectionFailed: "Не удалось открыть папку. Повторите попытку или выберите другую папку." },
  uk: { folderPermissionDenied: "Дозвольте цьому сайту доступ до папки та повторіть спробу.", folderSelectionFailed: "Не вдалося відкрити папку. Повторіть спробу або виберіть іншу папку." }
};

const latinAmericanSpanishRegions = new Set([
  "419", "ar", "bo", "cl", "co", "cr", "cu", "do", "ec", "sv", "gt", "hn",
  "mx", "ni", "pa", "py", "pe", "pr", "us", "uy", "ve",
]);

export function localeForLanguageIdentifier(identifier: string): Locale {
  const language = identifier.toLowerCase().replaceAll("_", "-");
  if (language.includes("zh-tw") || language.includes("zh-hk") || language.includes("hant")) return "zh-Hant";
  if (language.startsWith("zh")) return "zh-Hans";
  if (language.startsWith("pt-br")) return "pt-BR";
  if (language.startsWith("pt")) return "pt-PT";
  const fields = language.split("-");
  if (fields[0] === "es" && fields.slice(1).some((field) => latinAmericanSpanishRegions.has(field))) return "es-419";
  const short = fields[0];
  return isLocale(short) ? short : "en";
}

export function resolveLocale(): Locale {
  const segment = location.pathname.split("/").filter(Boolean)[0];
  if (isLocale(segment)) return segment;
  const stored = localStorage.getItem("watermelon-link-locale");
  if (isLocale(stored)) return stored;
  return localeForLanguageIdentifier(navigator.language);
}

export function localePath(locale: Locale): string {
  const pair = isPairingPath(location.pathname);
  if (locale === "en") return pair ? "/pair" : "/";
  return `/${locale}${pair ? "/pair" : "/"}`;
}

export function isPairingPath(pathname: string): boolean {
  return /(?:^|\/)pair\/?$/.test(pathname);
}

export function htmlLanguage(locale: Locale): string {
  if (locale === "zh-Hans") return "zh-CN";
  if (locale === "zh-Hant") return "zh-Hant";
  return locale;
}

export function translator(locale: Locale): (key: MessageKey) => string {
  return (key) => {
    if (key === "singleWriterDetail") return singleWriterDetails[locale];
    if (key === "peerDisconnected") return peerDisconnectedMessages[locale];
    if (key === "browserNodeInUse") return browserNodeInUseMessages[locale];
    if (key === "browserNodeCleanupPending") return browserNodeCleanupPendingMessages[locale];
    if (key in preflightMessages[locale]) return preflightMessages[locale][key as PreflightMessageKey];
    if (key in folderErrorMessages[locale]) return folderErrorMessages[locale][key as FolderErrorMessageKey];
    return messages[locale][key];
  };
}

function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && supportedLocales.includes(value as Locale);
}
