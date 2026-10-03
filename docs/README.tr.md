# Türkçe başlangıç rehberi

**lms omni gateway**, API üzerinden çalışan modelleri LM Studio sohbetinde kullanmak
için bir generator eklentisidir. Sağdaki yerleşik panelde her sağlayıcının model,
elle model kimliği, API anahtarı ve Base URL alanları ayrı tutulur.

[Ayrıntılı İngilizce README](../README.md) · [Kurulum](INSTALLATION.md) ·
[Sağlayıcılar](PROVIDERS.md) · [Gizlilik](PRIVACY.md)

## Kurulum

Generator eklentilerini destekleyen LM Studio, `lms` komutu, Git ve Node.js 22+
(npm ile) gerekir. Bu sürüm Windows / LM Studio 0.4.25 / SDK 1.4.0 ortamında doğrulandı.

LM Studio'yu en az bir kez açtıktan sonra terminalde:

```sh
git clone https://github.com/batuhankuneroglu/lms-omni-gateway.git
cd lms-omni-gateway
npm ci
npm run build
lms dev --install
```

Eklenti görünmezse LM Studio'yu tamamen kapatıp aç. Sohbetin model seçicisinden
**omni/lms-omni-gateway** seç. Git kullanmıyorsan GitHub'dan ZIP indirip çıkar;
çıkarılan klasörde son üç komutu çalıştır.

## İlk kullanım

1. Sağdaki **Generator** panelini aç.
2. **ACTIVE PROVIDER** alanından bu sohbetin sağlayıcısını seç.
3. İlgili bölümde kendi **API Key** ve **Base URL** bilgilerini gir.
4. `/models` yazarak API'nin verdiği model kimliklerini al.
5. Modeli listeden seç veya **Use custom model** seçip kimliği **Custom Model** alanına yaz.
6. Mesajını gönder.

Yeni çekilen modeller açılır listeye eklenti yeniden yüklendiğinde girer. Elle model
kimliğini hemen kullanabilirsin. Mevcut sağlayıcı/model, anahtar ve adres değişiklikleri
bir sonraki mesaja uygulanır. **ACTIVE PROVIDER sohbet başına**, sağlayıcının model
ve bağlantı alanları ise sohbetler arasında ortak kaydedilir.

Desteklenen profiller: Anthropic, Custom 1, Custom 2, DeepSeek, Evren.ssyz, Gemini,
GLM, Grok, Muskapi.cc, NVIDIA, OpenAI ve OpenRouter. Muskapi.cc adresini kendi
hesap panelinden kopyala; başlangıçta boş bırakılır. Evren.ssyz'nin varsayılan adresi
`https://evren-llmapi.ssyz.org.tr/v1` ve anahtar yöntemi `X-API-Key` olarak hazırdır.

## Komutlar ve göstergeler

| Komut | İşlev |
| --- | --- |
| `/settings` | Sağ panel ayarlarını açıklar |
| `/status` | Seçili sağlayıcı/model ve en son kaydedilen bakiye |
| `/models` | Model listesini API'den yeniler |
| `/usage` | Bu eklentinin yerelde kaydettiği token toplamları |
| `/balance` | DeepSeek/OpenRouter için anlık bakiye veya anahtar harcama limiti |
| `/image` | Windows'ta fotoğraf seçtirip gönderilecek komutu hazırlar |

**Show Token Usage**, **Show Model Info** ve **Show Speed & Time** anahtarları
birbirinden bağımsızdır. Araç çağrılı yanıtlarda toplam token/zaman bilgisi son
yanıtın altında bir kez gösterilir. Bu göstergeler için ayrıca model çağrısı yapılmaz.
Token bilgisini API vermezse değer uydurulmaz. Süre, ağ ve akış dahil API yanıt
süresidir; araç çalıştırma süresi sayılmaz. Token/s bu süreye göre ortalamadır.

Bakiye otomatik sorgulanmaz. `/balance` ayrı bir HTTP sorgusu yapar; sağlayıcının
HTTP hız sınırlarına sayılabilir. `/status` kayıtlı sonucu yerelden okur.
OpenRouter'da normal anahtarın limiti hesap bakiyesi değildir; hesap kredileri için
uygun yetkili bir Management Key gerekir. Diğer sağlayıcılarda bakiye sorgusu yoktur.

## Görsel gönderme

Kendi dosyanın gerçek yoluyla:

```text
/image "C:\photos\example.png" Bu fotoğrafta ne var?
```

Windows'ta `/image` ile seçim yapınca verilen komutu sohbete gönder. Dosya seçmek
tek başına yükleme yapmaz. Model görseli desteklemeli; metin modeli seçtiğinde önceki
mesajlarda bulunan görseller de hataya neden olabilir. Dosyayı takip soruları için sakla.

LM Studio'nun normal görsel düğmesini/Vision bayrağını API modelleri için açmak
bu sürümde mümkün değildir. `/image`, uygulama dosyalarını değiştirmeden kullanılan
yöntemdir. Açılır liste araması, favori yıldızları, canlı bölüm gizleme ve ikon
konumları da yerleşik eklenti arayüzünün mevcut sınırlarıdır.

## Açılış ve gizlilik

Eklenti kayıtlı model listeleriyle açılır. API sorguları kayıt tamamlandıktan sonra
arka planda başlar; yavaş sağlayıcı eklentinin kayıt aşamasını bekletmez.

Bu depo API anahtarı, sohbet geçmişi, bakiye/kullanım verisi veya kişisel yedek içermez.
Kendi anahtarlarını LM Studio'ya gir. Sohbet içeriği seçtiğin API'ye gönderilir;
korumalı anahtar alanı bir şifreli kasa değildir. Ayrıntılar [gizlilik belgesinde](PRIVACY.md).

Sonct'nin `openai-compat-endpoint` çalışması ve onun dayandığı LM Studio örneği temel
alınmıştır. Kaynak atıfları ve lisans bildirimleri [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)
dosyasında korunur.
