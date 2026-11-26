/** Everyday phrases for the interpreter's phrasebook, grouped by situation (English source text). */
export const PHRASEBOOK: { id: string; label: string; phrases: string[] }[] = [
  {
    id: "basics",
    label: "Basics",
    phrases: [
      "Hello!", "Good morning.", "Thank you very much.", "You're welcome.", "Please.", "Excuse me.", "Sorry.", "Yes.", "No.",
      "I don't understand.", "Can you speak more slowly, please?", "Do you speak English?", "What is your name?", "My name is…",
      "Nice to meet you.", "Goodbye!", "See you later.", "How are you?", "I'm fine, thank you.", "Could you write that down?",
    ],
  },
  {
    id: "travel",
    label: "Travel",
    phrases: [
      "Where is the train station?", "Where is the bus stop?", "How much is a ticket to the city centre?", "Which platform does the train leave from?",
      "Please take me to this address.", "How long does it take to get there?", "Is this seat free?", "I'd like a one-way ticket, please.",
      "Where is the airport?", "My flight is delayed.", "I have lost my luggage.", "Can you call a taxi for me?",
    ],
  },
  {
    id: "directions",
    label: "Directions",
    phrases: [
      "How do I get to…?", "Is it far from here?", "Can you show me on the map?", "Turn left.", "Turn right.", "Go straight ahead.",
      "Where is the nearest toilet?", "Where is the nearest ATM?", "Where is the nearest pharmacy?", "I'm lost.",
    ],
  },
  {
    id: "food",
    label: "Food & drink",
    phrases: [
      "A table for two, please.", "Can I see the menu?", "What do you recommend?", "I'm vegetarian.", "I'm allergic to nuts.",
      "Is this spicy?", "Not too spicy, please.", "Water, please.", "The bill, please.", "It was delicious!", "Can I pay by card?",
      "No sugar, please.", "Do you have anything without meat?",
    ],
  },
  {
    id: "shopping",
    label: "Shopping",
    phrases: [
      "How much does this cost?", "That's too expensive.", "Can you give me a discount?", "Do you have this in another size?",
      "Do you have this in another colour?", "I'm just looking, thank you.", "I'll take it.", "Can I have a receipt?", "Where can I try this on?",
    ],
  },
  {
    id: "hotel",
    label: "Hotel",
    phrases: [
      "I have a reservation.", "Do you have a room for tonight?", "What time is check-out?", "Is breakfast included?", "The air conditioning doesn't work.",
      "Can I have another towel?", "What is the Wi-Fi password?", "Can I leave my bags here?", "Please wake me up at seven o'clock.",
    ],
  },
  {
    id: "health",
    label: "Health",
    phrases: [
      "I need a doctor.", "I don't feel well.", "I have a headache.", "I have a fever.", "Where is the hospital?", "I need medicine for this.",
      "I am diabetic.", "I am pregnant.", "It hurts here.", "I take this medication every day.",
    ],
  },
  {
    id: "emergency",
    label: "Emergency",
    phrases: [
      "Help!", "Call the police!", "Call an ambulance!", "There's been an accident.", "Fire!", "I've been robbed.", "I've lost my passport.",
      "Please help me.", "Where is the embassy?", "It's an emergency.",
    ],
  },
];
