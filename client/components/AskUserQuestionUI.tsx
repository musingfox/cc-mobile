import { useState } from "react";
import "./linear/ask-question.css";
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
  const [customAnswer, setCustomAnswer] = useState("");

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  if (!currentQuestion) {
    return null;
  }

  if (currentQuestion.multiSelect) {
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
        setCustomAnswer("");
      }
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setCustomAnswer("");
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setCustomAnswer("");
    }
  };

  const questionContent = (
    <div className="ask-user-question-content lin-ask-content">
      <div className="permission-tool-info lin-ask-header">
        <span className="permission-tool-name lin-ask-header-label">
          {currentQuestion.header || "Question"}
        </span>
        <div className="ask-user-question lin-ask-question">{currentQuestion.question}</div>
      </div>
      <div className="permission-actions ask-user-actions lin-ask-actions">
        {currentQuestion.options?.map((option) => (
          <OptionButton
            key={option.label}
            option={option}
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
