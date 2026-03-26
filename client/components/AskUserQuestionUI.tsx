import { useState } from "react";
import OptionButton from "./OptionButton";
import QuestionStepper from "./QuestionStepper";

type Question = {
  question: string;
  header: string;
  options: Array<{
    label: string;
    description: string;
    preview?: string;
  }>;
  multiSelect?: boolean;
};

type AskUserQuestionUIProps = {
  questions: Question[];
  onAnswer: (answers: Record<string, string>) => void;
};

export default function AskUserQuestionUI({ questions, onAnswer }: AskUserQuestionUIProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [expandedOptionIndex, setExpandedOptionIndex] = useState<number | null>(null);
  const [customAnswer, setCustomAnswer] = useState("");

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  if (currentQuestion?.multiSelect) {
    return <div className="question-error">Multi-select questions are not yet supported</div>;
  }

  const handleSelectOption = (label: string) => {
    const newAnswers = { ...answers, [currentQuestion.question]: label };

    if (questions.length === 1) {
      onAnswer(newAnswers);
    } else {
      setAnswers(newAnswers);
      if (isLastQuestion) {
        onAnswer(newAnswers);
      } else {
        setCurrentIndex(currentIndex + 1);
        setExpandedOptionIndex(null);
        setCustomAnswer("");
      }
    }
  };

  const handleCustomAnswer = () => {
    const trimmed = customAnswer.trim();
    if (!trimmed) return;

    const newAnswers = { ...answers, [currentQuestion.question]: trimmed };

    if (questions.length === 1) {
      onAnswer(newAnswers);
    } else {
      setAnswers(newAnswers);
      if (isLastQuestion) {
        onAnswer(newAnswers);
      } else {
        setCurrentIndex(currentIndex + 1);
        setExpandedOptionIndex(null);
        setCustomAnswer("");
      }
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setExpandedOptionIndex(null);
      setCustomAnswer("");
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setExpandedOptionIndex(null);
      setCustomAnswer("");
    }
  };

  const questionContent = (
    <div className="ask-user-question-content">
      <div className="permission-tool-info">
        <span className="permission-tool-name">{currentQuestion.header || "Question"}</span>
        <div className="ask-user-question">{currentQuestion.question}</div>
      </div>
      <div className="permission-actions ask-user-actions">
        {currentQuestion.options?.map((option, idx) => (
          <OptionButton
            key={option.label}
            option={option}
            expanded={expandedOptionIndex === idx}
            onTogglePreview={() => setExpandedOptionIndex(expandedOptionIndex === idx ? null : idx)}
            onSelect={() => handleSelectOption(option.label)}
          />
        ))}
        <div className="custom-answer-row">
          <input
            type="text"
            className="custom-answer-input"
            placeholder="Other (type your answer)"
            value={customAnswer}
            onChange={(e) => setCustomAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customAnswer.trim()) {
                handleCustomAnswer();
              }
            }}
          />
          <button
            type="button"
            className="permission-btn green"
            onClick={handleCustomAnswer}
            disabled={!customAnswer.trim()}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );

  if (questions.length === 1) {
    return <div className="permission-footer">{questionContent}</div>;
  }

  return (
    <div className="permission-footer">
      <QuestionStepper
        total={questions.length}
        currentIndex={currentIndex}
        onNext={handleNext}
        onPrevious={handlePrevious}
      >
        {questionContent}
      </QuestionStepper>
    </div>
  );
}
