import React from 'react';
import '../Styles/Project.less';
import ContactForm from '../Components/ContactForm';

export default class ContactInfo extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        return(
            <div className="contactinfo">
                <div className="location">
                    <h3> Currently Located: Kelowna</h3>
                </div>
                <div className="social">
                    <a href="https://www.linkedin.com/in/robert-hill-470068a8/">
                        <i className="linkedin" />
                    </a>
                    <a href="https://twitter.com/RobertHill352">
                        <i className="twitter" />
                    </a>
                </div>
            </div>

        )
    }
}
