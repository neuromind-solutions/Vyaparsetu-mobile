/**
 * Script to generate complete Maharashtra APMC Market Vegetables Excel File
 * Formatted for VyapaarSetu bulk import and standard APMC mandi catalog.
 */

const path = require('path');
const XLSX = require('../frontend/node_modules/xlsx');

const vegetablesData = [
  // ─── 1. पालेभाज्या (Leafy Vegetables) ───────────────────────────────────────
  {
    name: 'कोथिंबीर',
    rate: 15,
    unit: 'bundle',
    keywords: 'coriander, kothimbir, dhania, kothmir, green coriander',
    notes: 'ताजी जुडी / गड्डी (Fresh green)',
  },
  {
    name: 'मेथी',
    rate: 20,
    unit: 'bundle',
    keywords: 'fenugreek, methi, leafy methi, kasuri',
    notes: 'गावरान मेथी जुडी',
  },
  {
    name: 'पालक',
    rate: 15,
    unit: 'bundle',
    keywords: 'spinach, palak, paalak, green spinach',
    notes: 'मोठी जुडी / बारीक पाने',
  },
  {
    name: 'शेपू',
    rate: 15,
    unit: 'bundle',
    keywords: 'dill, shepu, suva, sowa, dill leaves',
    notes: 'ताजा शेपू जुडी',
  },
  {
    name: 'कांदा पात',
    rate: 20,
    unit: 'bundle',
    keywords: 'spring onion, kanda paat, onion greens, scalliion',
    notes: 'हिरवी पात जुडी',
  },
  {
    name: 'पुदिना',
    rate: 10,
    unit: 'bundle',
    keywords: 'mint, pudina, phudina, fresh mint',
    notes: 'सुगंधी पुदिना जुडी',
  },
  {
    name: 'कढीपत्ता',
    rate: 50,
    unit: 'kg',
    keywords: 'curry leaves, kadhipatta, curry leaves, kadi patta',
    notes: 'ताजा हिरवा कढीपत्ता',
  },
  {
    name: 'अळू पाने',
    rate: 20,
    unit: 'bundle',
    keywords: 'colocasia leaves, alu paan, aloo paan, arbi leaves, patra',
    notes: 'वडीची पाने (५-१० नग जुडी)',
  },
  {
    name: 'चवळी पात',
    rate: 15,
    unit: 'bundle',
    keywords: 'cowpea greens, chawali paat, chawli leaves',
    notes: 'ताजी पालेभाजी जुडी',
  },
  {
    name: 'करडई',
    rate: 15,
    unit: 'bundle',
    keywords: 'safflower leaves, kardai, kardai bhaji',
    notes: 'गावरान करडई जुडी',
  },
  {
    name: 'राजगिरा',
    rate: 15,
    unit: 'bundle',
    keywords: 'rajgira, amaranth, rajgira bhaji',
    notes: 'पालेभाजी जुडी',
  },
  {
    name: 'लाल माठ',
    rate: 20,
    unit: 'bundle',
    keywords: 'red amaranth, laal math, lal math, chaulai',
    notes: 'ताजा लाल माठ जुडी',
  },
  {
    name: 'हिरवा माठ',
    rate: 15,
    unit: 'bundle',
    keywords: 'green amaranth, hirwa math, math bhaji',
    notes: 'ताजा हिरवा माठ जुडी',
  },
  {
    name: 'तांदुळजा',
    rate: 15,
    unit: 'bundle',
    keywords: 'tandulja, tandulja bhaji, amaranth greens',
    notes: 'रानभाजी / पालेभाजी जुडी',
  },
  {
    name: 'चुका',
    rate: 15,
    unit: 'bundle',
    keywords: 'green sorrel, chuka, chuka bhaji, khatta saag',
    notes: 'आंबट चुका जुडी',
  },
  {
    name: 'अंबाडी',
    rate: 15,
    unit: 'bundle',
    keywords: 'ambadi, gongura, sorrel leaves, pitwa',
    notes: 'आंबट अंबाडी जुडी',
  },

  // ─── 2. फळभाज्या (Fruit Vegetables) ─────────────────────────────────────────
  {
    name: 'टोमॅटो',
    rate: 35,
    unit: 'kg',
    keywords: 'tomato, tamatar, laal tomato, vaishali tomato',
    notes: 'पक्का लाल माल (क्रेट / किलो)',
  },
  {
    name: 'कांदे बटाटा (जोडी)',
    rate: 55,
    unit: 'kg',
    keywords: 'kanda batata, onion potato combo',
    notes: 'नियमित जोडी',
  },
  {
    name: 'वांगी (काटेरी)',
    rate: 40,
    unit: 'kg',
    keywords: 'brinjal, kateri vangi, eggplant, baingan, ravaiya',
    notes: 'भरताची / काटेरी गावरान वांगी',
  },
  {
    name: 'वांगी (काळी / साधी)',
    rate: 35,
    unit: 'kg',
    keywords: 'brinjal, kali vangi, eggplant, baingan',
    notes: 'काळी चकचकीत वांगी',
  },
  {
    name: 'काकडी',
    rate: 30,
    unit: 'kg',
    keywords: 'cucumber, kakdi, kheera, salad kakdi',
    notes: 'हिरवी कोवळी काकडी',
  },
  {
    name: 'भेंडी',
    rate: 50,
    unit: 'kg',
    keywords: 'lady finger, bhendi, okra, bhindi',
    notes: 'कोवळी हिरवी भेंडी',
  },
  {
    name: 'गवार',
    rate: 60,
    unit: 'kg',
    keywords: 'cluster beans, gavar, guvar, gavari',
    notes: 'गावरान / देशी बारीक गवार',
  },
  {
    name: 'शेवगा शेंग',
    rate: 80,
    unit: 'kg',
    keywords: 'drumstick, shevga, shevaga, sahjan',
    notes: 'लांब हिरवी गरदार शेंग',
  },
  {
    name: 'दुधी भोपळा',
    rate: 30,
    unit: 'kg',
    keywords: 'bottle gourd, dudhi bhopla, lauki, ghiya',
    notes: 'कोवळा लांब दुधी भोपळा',
  },
  {
    name: 'लाल भोपळा',
    rate: 25,
    unit: 'kg',
    keywords: 'pumpkin, laal bhopla, kaddu, red pumpkin',
    notes: 'पिवळा / लाल गोड भोपळा',
  },
  {
    name: 'कारले',
    rate: 50,
    unit: 'kg',
    keywords: 'bitter gourd, karle, karela, karel',
    notes: 'हिरवे काटेरी कारले',
  },
  {
    name: 'दोडका (शिराळे)',
    rate: 50,
    unit: 'kg',
    keywords: 'ridge gourd, dodka, shirale, turai, tori',
    notes: 'कोवळा दोडका',
  },
  {
    name: 'घोसाळे',
    rate: 45,
    unit: 'kg',
    keywords: 'sponge gourd, ghosale, ghosali, luffa, gilki',
    notes: 'ताजे घोसाळे',
  },
  {
    name: 'गिलके',
    rate: 40,
    unit: 'kg',
    keywords: 'smooth gourd, gilke, nenua, luffa cylindrica',
    notes: 'ताजे गिलके',
  },
  {
    name: 'पडवळ',
    rate: 40,
    unit: 'kg',
    keywords: 'snake gourd, padwal, chichinda, parwal',
    notes: 'लांब पांढरे पडवळ',
  },
  {
    name: 'तोंडली',
    rate: 50,
    unit: 'kg',
    keywords: 'ivy gourd, tondli, kundru, tendli',
    notes: 'बारीक कोवळी तोंडली',
  },
  {
    name: 'फ्लॉवर',
    rate: 40,
    unit: 'kg',
    keywords: 'cauliflower, flower, phool gobi, fulawar',
    notes: 'पांढरा शुभ्र घट्ट गड्डा',
  },
  {
    name: 'कोबी',
    rate: 25,
    unit: 'kg',
    keywords: 'cabbage, kobi, patta gobi, band gobi',
    notes: 'घट्ट हिरवा कोबी गड्डा',
  },
  {
    name: 'ढोबळी मिरची (शिमला)',
    rate: 55,
    unit: 'kg',
    keywords: 'capsicum, shimla mirchi, dhobli mirchi, bell pepper',
    notes: 'हिरवी टपोरी शिमला मिरची',
  },
  {
    name: 'मटार (वाटाणा)',
    rate: 70,
    unit: 'kg',
    keywords: 'green peas, matar, vatana, watana',
    notes: 'गोड भरलेला मटार',
  },
  {
    name: 'घेवडा (फरसबी)',
    rate: 60,
    unit: 'kg',
    keywords: 'french beans, ghevda, farasbi, beans',
    notes: 'कोवळी फरसबी',
  },
  {
    name: 'श्रावण घेवडा',
    rate: 65,
    unit: 'kg',
    keywords: 'shravan ghevda, flat beans, sem fali',
    notes: 'कोवळी चवदार शेंग',
  },
  {
    name: 'वाल पापडी',
    rate: 55,
    unit: 'kg',
    keywords: 'field beans, vaal papdi, papdi, surti papdi',
    notes: 'गावरान वाल पापडी',
  },
  {
    name: 'चवळी शेंग',
    rate: 50,
    unit: 'kg',
    keywords: 'cowpea pod, chawali sheng, lobia fali',
    notes: 'लांब हिरवी शेंग',
  },
  {
    name: 'मका कणीस',
    rate: 15,
    unit: 'piece',
    keywords: 'sweet corn, maka kanis, maize, corn cob',
    notes: 'अमेरिकन / देशी गोड कणीस',
  },
  {
    name: 'सुरण',
    rate: 60,
    unit: 'kg',
    keywords: 'elephant foot yam, suran, jimikand',
    notes: 'देशी सुरण',
  },

  // ─── 3. कंदमुळे व मूळभाज्या (Roots & Tubers) ─────────────────────────────────
  {
    name: 'बटाटा',
    rate: 30,
    unit: 'kg',
    keywords: 'potato, batata, aloo, talegaon batata, indore batata',
    notes: 'तळेगाव / इंदोर नवीन बटाटा',
  },
  {
    name: 'कांदा (लाल)',
    rate: 28,
    unit: 'kg',
    keywords: 'onion, kanda, pyaj, laal kanda, lasalgaon kanda',
    notes: 'नाशिक / लासलगाव दर्जेदार लाल कांदा',
  },
  {
    name: 'कांदा (पांढरा)',
    rate: 35,
    unit: 'kg',
    keywords: 'white onion, pandhra kanda, safed pyaz',
    notes: 'अलिबाग / महाड पांढरा कांदा',
  },
  {
    name: 'लसूण (देशी)',
    rate: 180,
    unit: 'kg',
    keywords: 'garlic, lasun, lahsun, desi lasun',
    notes: 'देशी बारीक सुका लसूण',
  },
  {
    name: 'लसूण (मोठा / ऊटी)',
    rate: 220,
    unit: 'kg',
    keywords: 'garlic, ooty lasun, mota lasun, hybrid garlic',
    notes: 'टपोरा ऊटी लसूण',
  },
  {
    name: 'आले (अद्रक)',
    rate: 120,
    unit: 'kg',
    keywords: 'ginger, aale, adrak, fresh ginger',
    notes: 'सातारा / औरंगाबाद दर्जेदार आले',
  },
  {
    name: 'गाजर (ऑरेंज / इंग्रजी)',
    rate: 40,
    unit: 'kg',
    keywords: 'carrot, gajar, orange gajar, salad carrot',
    notes: 'ताजे रसाळ गाजर',
  },
  {
    name: 'गाजर (लाल / गावरान)',
    rate: 45,
    unit: 'kg',
    keywords: 'red carrot, desi gajar, laal gajar',
    notes: 'हिवाळी गोड लाल गाजर',
  },
  {
    name: 'मुळा',
    rate: 25,
    unit: 'kg',
    keywords: 'radish, mula, mooli, white radish',
    notes: 'पांढरा कोवळा मुळा (पानांसहित)',
  },
  {
    name: 'बीट',
    rate: 40,
    unit: 'kg',
    keywords: 'beetroot, beat, chukandar, red beet',
    notes: 'लाल रंगाचे टपोरे बीट',
  },
  {
    name: 'रताळे',
    rate: 50,
    unit: 'kg',
    keywords: 'sweet potato, ratale, shakarkand, ratalu',
    notes: 'उपवासाचे गोड रताळे',
  },
  {
    name: 'अळकुडी (अरबी / अळू कंद)',
    rate: 60,
    unit: 'kg',
    keywords: 'colocasia root, alkudi, arbi, alu gadda, taro root',
    notes: 'सुके अळू कंद',
  },
  {
    name: 'ओली हळद',
    rate: 90,
    unit: 'kg',
    keywords: 'fresh turmeric, oli halad, kachi haldi',
    notes: 'पिवळी औषधी हळद',
  },
  {
    name: 'आंबेहळद',
    rate: 100,
    unit: 'kg',
    keywords: 'mango ginger, ambehalad, amba haldi',
    notes: 'सुगंधी आंबेहळद',
  },

  // ─── 4. मिरची, लिंबू व मसाले (Chilli, Lemon & Spices) ────────────────────────
  {
    name: 'हिरवी मिरची (लवंगी / तिखट)',
    rate: 60,
    unit: 'kg',
    keywords: 'green chilli, lavangi mirchi, spicy chilli, hari mirch',
    notes: 'बारीक तिखट लवंगी मिरची',
  },
  {
    name: 'हिरवी मिरची (ज्वाला / मध्यम)',
    rate: 50,
    unit: 'kg',
    keywords: 'green chilli, jwala mirchi, medium spicy chilli',
    notes: 'लांब मध्यम तिखट मिरची',
  },
  {
    name: 'हिरवी मिरची (भजी मिरची / फिकट)',
    rate: 55,
    unit: 'kg',
    keywords: 'bhavnagri mirchi, bhaji mirchi, thick chilli, pakoda mirchi',
    notes: 'भजीसाठी जाड फिकट मिरची',
  },
  {
    name: 'लाल मिरची (ओली)',
    rate: 80,
    unit: 'kg',
    keywords: 'fresh red chilli, oli laal mirchi, pickle chilli',
    notes: 'लोणच्याची ताजी लाल मिरची',
  },
  {
    name: 'लिंबू (टपोरे)',
    rate: 3,
    unit: 'piece',
    keywords: 'lemon, limbu, nimbu, yellow lemon',
    notes: 'रसदार पिवळे लिंबू (नग / शेकडा)',
  },
  {
    name: 'ओला नारळ',
    rate: 30,
    unit: 'piece',
    keywords: 'fresh coconut, ola naral, nariyal, water coconut',
    notes: 'पाणी असलेला ताजा नारळ (नग)',
  },
  {
    name: 'चिंच (ओली / पिकलेली)',
    rate: 140,
    unit: 'kg',
    keywords: 'tamarind, chinch, imli, fresh tamarind',
    notes: 'देशी चवदार चिंच',
  },

  // ─── 5. फळे, कंद व विशेष हंगामी भाज्या (Exotic & Special) ────────────────────
  {
    name: 'कच्ची केळी',
    rate: 5,
    unit: 'piece',
    keywords: 'raw banana, kacchi keli, kacha kela, green banana',
    notes: 'भाजी / वेफर्ससाठी हिरवी केळी (नग / डझन)',
  },
  {
    name: 'कच्ची पपई',
    rate: 25,
    unit: 'kg',
    keywords: 'raw papaya, kacchi papai, kacha papita',
    notes: 'कोशिंबिरीसाठी हिरवी घट्ट पपई',
  },
  {
    name: 'कच्ची कैरी (तोतापुरी / राजापुरी)',
    rate: 50,
    unit: 'kg',
    keywords: 'raw mango, kairi, kacha aam, totapuri, rajapuri',
    notes: 'लोणचे / पन्हे यासाठी कैरी',
  },
  {
    name: 'ब्रोकोली',
    rate: 120,
    unit: 'kg',
    keywords: 'broccoli, green broccoli, exotic veg',
    notes: 'हिरवी ताजी ब्रोकोली',
  },
  {
    name: 'मशरूम (बटन)',
    rate: 50,
    unit: 'piece',
    keywords: 'mushroom, button mushroom, khumb',
    notes: '२०० ग्रॅम पॅकेट / डिश',
  },
  {
    name: 'बेबी कॉर्न',
    rate: 60,
    unit: 'kg',
    keywords: 'baby corn, sweet baby corn',
    notes: 'सोललेला ताजा बेबी कॉर्न',
  },
  {
    name: 'झुकिनी (पिवळी / हिरवी)',
    rate: 80,
    unit: 'kg',
    keywords: 'zucchini, courgette, yellow zucchini, green zucchini',
    notes: 'ताजी झुकिनी',
  },
  {
    name: 'केळफूल (केळीचे फूल)',
    rate: 30,
    unit: 'piece',
    keywords: 'banana flower, kelful, banana blossom',
    notes: 'औषधी भाजीसाठी केळफूल (नग)',
  },
  {
    name: 'शेवंती / भाजीची फुले',
    rate: 40,
    unit: 'kg',
    keywords: 'edible flower, shevanti, flower veg',
    notes: 'हंगामी भाजी फुले',
  },
  {
    name: 'कंटोली (रानकारले / कर्टुले)',
    rate: 140,
    unit: 'kg',
    keywords: 'spiny gourd, kantoli, kartule, ran karle, kakrol',
    notes: 'पावसाळी पौष्टिक रानभाजी',
  },
  {
    name: 'टाकळा (रानभाजी)',
    rate: 20,
    unit: 'bundle',
    keywords: 'takla, ranbhaji, cassia tora, wild greens',
    notes: 'पावसाळी रानभाजी जुडी',
  },
  {
    name: 'शेवळा (रानभाजी)',
    rate: 60,
    unit: 'bundle',
    keywords: 'shevala, ranbhaji, dragon stalk yam',
    notes: 'पावसाळी चवदार रानभाजी',
  },
  {
    name: 'कुर्डू (रानभाजी)',
    rate: 20,
    unit: 'bundle',
    keywords: 'kurdu, ranbhaji, celosia argentea',
    notes: 'पावसाळी रानभाजी जुडी',
  },
];

function generateExcel() {
  const headers = [
    'भाजीचे नाव (Name)',
    'दर / Rate (₹)',
    'एकक / Unit',
    'शोध कीवर्ड (Search Keywords)',
    'टिप्पणी / Notes',
  ];

  const rows = [headers];

  vegetablesData.forEach((veg) => {
    rows.push([
      veg.name,
      veg.rate,
      veg.unit,
      veg.keywords,
      veg.notes,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Styling / column widths
  ws['!cols'] = [
    { wch: 32 }, // भाजीचे नाव
    { wch: 16 }, // दर / Rate
    { wch: 14 }, // एकक / Unit
    { wch: 45 }, // शोध कीवर्ड
    { wch: 38 }, // टिप्पणी / Notes
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'APMC_Vegetables_Catalog');

  const outputPath = path.resolve(__dirname, '../Maharashtra_APMC_Vegetables_Catalog.xlsx');
  XLSX.writeFile(wb, outputPath);

  console.log(`Successfully generated: ${outputPath}`);
  console.log(`Total vegetables included: ${vegetablesData.length}`);
}

generateExcel();
